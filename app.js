"use strict";

try {
    require("./conf.js");
} catch(e) {
    console.log("Can't find conf.js, cannot proceed. It can be procured from the git repo you got the app from.");
    process.exit(1);
}

var _s = require("underscore.string");

var GoogleAnalytics = require("ga");
var ga = new GoogleAnalytics(process.env.hnweekly_google_analytics_id, process.env.hnweekly_fqdn);

var pg = require("pg");
var client = new pg.Client(_s.sprintf("postgres://%s:%s@%s:%s/%s", 
    process.env.hnweekly_postgres_user,
    process.env.hnweekly_postgres_password,
    process.env.hnweekly_postgres_host,
    process.env.hnweekly_postgres_port,
    process.env.hnweekly_postgres_db
));
client.connect();

var cronJob = require("cron").CronJob;
new cronJob({
    cronTime: "0 * * * *",
    onTick: function() {
        console.log("Cronning");
        refresh_data();
        prune_data();
    },
    timeZone: "UTC",
    start: true
});


var express = require("express");
var app = express();
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use(express.logger());
var cons = require("consolidate");
app.engine("mustache", cons.mustache);
app.set("view engine", "mustache");
app.set("views", __dirname + "/templates");
app.use(express.static(__dirname + "/static"));

var step = require("step");

var cache_age = 1000 * 60 * 30;
var LRU = require("lru-cache");
var cache = LRU({
    max: 1024 * 1024 * 15,
    length: function(val) {return JSON.stringify(val).length;},
    maxAge: cache_age
});

var Requester = require("requester");
var requester = new Requester();

app.get("/", function(req, res) {
    res.render(
        "index",
        {partials: {
            header: "header",
            footer: "footer"
        }}
    );
});

app.get("/about", function(req, res) {
    res.render(
        "about",
        {
            title: "About - ",
            partials: {
                header: "header",
                footer: "footer"
            }
        }
    );
});

app.get("/posts.json", function(req, res) {
    try {
        validate_inputs(req, res);
    } catch(e) {
        return;
    }

    do_stuff(req, function(posts) {
        res.send({
            posts: posts,
            num_posts: posts.length
        });
    });
});

app.get("/feed.xml", function(req, res) {
    try {
        validate_inputs(req, res);
    } catch(e) {
        return;
    }

    do_stuff(req, function(posts) {
        res.type("application/rss+xml");
        res.render(
            "feed",
            {posts: posts}
        );
    });
});

var do_stuff = function(req, callback) {
    var day = parseInt(req.query.day) + 1 || new Date().getUTCDay() + 1;
    var time_of_day = req.query.time_of_day || "midnight";
    var threshold = parseInt(req.query.threshold) || 25;

    //var vals = cache.values();
    //for(var v in vals) console.log(JSON.stringify(vals[v]).length / (1024 * 1024));

    step(
        function() {
            client.query(
                "select * " +
                "from post_uses " +
                "join posts " +
                "on posts.post_id=post_uses.post_id " +
                "where " +
                    "to_char(post_uses.use_date, 'D')::integer = $1 " +
                    "and post_uses.use_tod = $2 " +
                    "and use_date::date = (" +
                        "select max(use_date::date) " +
                        "from post_uses " +
                        "where " +
                            "to_char(post_uses.use_date, 'D')::integer = $1 " +
                            "and post_uses.use_tod = $2 " +
                    ") " +
                "order by posts.points desc " +
                "limit $3",
                [day, time_of_day, threshold],
                this
            );
        },
        function(err, results) {
            var posts = results.rows;
            for(var post in posts) {
                posts[post].permalink = "http://news.ycombinator.com/item?id=" + posts[post].post_id;
                var d = new Date(posts[post].creation_date);

                posts[post].rss_date = d.toUTCString();
            }
            callback(posts);
        }
    );
}

var refresh_data = function() {
    var start_date = new Date();
    start_date.setTime(start_date.getTime() - 1000 * 60 * 60 * 24 * 14);
    var max_posts = 1000;
    var limit = 100;
    var query_str = "http://api.thriftdb.com/api.hnsearch.com/items/_search?filter[fields][create_ts]=[%s TO *]&filter[fields][type]=submission&pretty_print=true&sortby=points desc&limit=%d&start=%d";
    var start_index = 0;

    step(
        function() {
            var group = this.group();
            while(start_index + limit <= max_posts) {
                (function(group) {
                    requester.get(
                        _s.sprintf(
                            query_str, start_date.toISOString(),
                            limit,
                            start_index
                        ), 
                        function(body) {
                            group(null, body);
                        }
                    );
                })(group());
                start_index += limit;
            }
        },
        function(err, posts_arrays) {
            for(var posts_array in posts_arrays) {
                var posts = posts_arrays[posts_array];
                var resp = JSON.parse(posts);
                posts = resp.results;

                var group = this.group();
                for(var post in posts) {
                    if(!posts.hasOwnProperty(post)) continue;

                    (function(post, group) {
                        step(
                            function() {
                                client.query(
                                    "update posts set points=$1, title=$2, num_comments=$3 where post_id=$4",
                                    [post.points, post.title, post.num_comments, new Date(post.create_ts)],
                                    this
                                );
                            },
                            function(err, results) {
                                client.query(
                                    "insert into posts (" +
                                        "post_id, " +
                                        "points, " +
                                        "title, " +
                                        "domain, " +
                                        "username, " +
                                        "url, " +
                                        "num_comments, " +
                                        "creation_date" +
                                    ") select $1, $2, $3, $4, $5, $6, $7, $8 where not exists (select 1 from posts where post_id=$1)",
                                    [
                                        post.id,
                                        post.points,
                                        post.title,
                                        post.domain,
                                        post.username,
                                        post.url,
                                        post.num_comments,
                                        new Date(post.create_ts)
                                    ],
                                    group
                                );
                            }
                        );
                    })(posts[post].item, group());
                }
            }
        },
        function(err, results) {
            if(false) {
                return;
            }

            step(
                function() {
                    client.query("BEGIN", this);
                },
                function(err, results) {
                    var time_of_day = calc_time_of_day();

                    client.query(
                        "select count(*) from post_uses",
                        this
                    );
                },
                function(err, results) {
                    if(results.rows[0].count == 0) {
                        backfill_data(this);
                    } else {
                        setTimeout(this, 0);
                    }
                },
                function(err, results) {
                    var time_of_day = calc_time_of_day();
                    client.query(
                        "insert into post_uses (" +
                            "select " +
                                "posts.post_id, " +
                                "current_timestamp as use_date, " +
                                "$1 as use_tod " +
                            "from posts " +
                            "left outer join (" +
                                "select * from post_uses " +
                                "where " +
                                    "use_tod = $1 and " +
                                    "to_char(use_date, 'D')::integer = $2 " +
                                    "and use_tod != 'bogus'" +
                            ") as post_uses " +
                            "on posts.post_id=post_uses.post_id " +
                            "where post_uses.post_id is null " +
                            "order by posts.points desc " +
                            "limit 1000" +
                        ")",
                        [time_of_day, new Date().getUTCDay() + 1], // JS uses days starting at 0, postgres starting at 1
                        this
                    );
                },
                function(err, results) {
                    //console.log(err);
                    //console.log(results.rows.length);
                    //console.log(results.rows);

                    client.query("END", this);
                }
            );
        }
    );
};


var prune_data = function() {
    client.query("delete from posts where age(creation_date) > '2 weeks'");
}


var backfill_data = function(cb) {
    step(
        function() {
            client.query("select * from posts", this);
        },
        function(err, results) {
            var posts = results.rows;
            var group = this.group();
            var dates = (function(posts) {
                var dates = [];
                for(var post in posts) {
                    var d = new Date(posts[post].creation_date);
                    var date_str = _s.sprintf("%d-%02d-%02d", d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
                    if(dates.indexOf(date_str) === -1) {
                        dates.push(date_str);
                    }
                }
                return dates;
            })(posts);

            var tods = ["midnight", "morning", "noon", "evening"];
            for(var date in dates) {
                for(var tod in tods) {
                    (function(d, tod, group) {
                        client.query("insert into post_uses (select post_id, $1 as use_date, $2 as use_tod from posts where age($1, creation_date) between '0 seconds' and '1 week' order by points desc limit 1000)", [d, tod], group);
                    })(new Date(dates[date]), tods[tod], group());
                }
            }
        },
        function(err, results) {
            setTimeout(cb, 0);
        }
    );
}


var calc_time_of_day = function() {
    var hour = new Date().getUTCHours();
    if(hour < 6) {
        return "midnight";
    } else if(hour < 12) {
        return "morning";
    } else if(hour < 18) {
        return "noon";
    } else {
        return "evening";
    }
}


var validate_inputs = function(req, res) {
    if(req.query.threshold) {
        if(req.query.threshold <= 0 || req.query.threshold > 300) {
            res.send(404, {error: "Threshold out of range"});
            throw "Threshold out of range";
        }
    }

    if(req.query.day) {
        if(req.query.day < 0 || req.query.day > 6) {
            res.send(404, {error: "Day out of range"});
            throw "Day out of range";
        }
    }
}

var percentile_filter = function(posts, threshold) {
    var culled_post_count = Math.round(posts.length * (1-threshold) + .5);  // Not sure what the .5 is for, but that's what Wikipedia says should be in there
    var culled_posts = posts.slice(0, culled_post_count);

    return culled_posts;
}


var within_cache_intelval = function(day) {
    var now = new Date();
    var start = new Date();
    start.setUTCHours(0);
    start.setUTCMinutes(0);
    start.setUTCMilliseconds(0);
    start.setTime(start.getTime() + 1000 * 60 * 60 * 24);  // Forces checks for e.g., day 2 while on day 2, to check /next week's/ day 2 and not the already-past today-at-midnight
    while(start.getUTCDay() != day) {
        start.setTime(start.getTime() + 1000 * 60 * 60 * 24);
    }
    return (start - now) > cache_age;
}


var calc_ts_range = function(day) {
    var end = new Date();
    end.setUTCHours(0);
    end.setUTCMinutes(0);
    end.setUTCMilliseconds(0);
    while(end.getUTCDay() != day) {
        end.setTime(end.getTime() - 1000 * 60 * 60 * 24);
    }

    var start = new Date();
    start.setTime(end.getTime() - 1000 * 60 * 60 * 24 * 7);

    return {
        start: start.toISOString(),
        end: end.toISOString()
    };
}

process.on("SIGINT", function() {
    console.warn("Cleaning up...");
    client.end();
    process.exit(0);
});

refresh_data();

app.listen(process.env.VCAP_APP_PORT || 3000);
console.log("Yay, started!");
