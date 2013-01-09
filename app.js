"use strict";

try {
    var conf = require("./conf.js");
} catch(e) {}

var GoogleAnalytics = require("ga");
var ga = new GoogleAnalytics(conf.google_analytics_id, conf.fqdn);

var cons = require("consolidate");

var pg = require("pg");
var client = new pg.Client("postgres://postgres:postgres@localhost:5432/hnweekly");
client.connect();

var express = require("express");
var app = express();
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use(express.logger());
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

var _s = require("underscore.string");

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
        //console.log(posts);
        res.send({
            posts: posts,
            point_range: calc_point_range(posts),
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
    var day = req.query.day || new Date().getUTCDay();
    var threshold = req.query.threshold || 25;

    //var vals = cache.values();
    //for(var v in vals) console.log(JSON.stringify(vals[v]).length / (1024 * 1024));

    refresh_data(day, 0, function(posts) {
        var culled_posts = posts.slice(0, threshold);
        callback(culled_posts);
    });
}

var refresh_data = function(start_index, posts) {
    var start_date = new Date();
    start_date.setTime(start_date.getTime() - 1000 * 60 * 60 * 24 * 14);
    var max_posts = 300;
    var limit = 100;
    var query_str = "http://api.thriftdb.com/api.hnsearch.com/items/_search?filter[fields][create_ts]=[%s TO *]&filter[fields][type]=submission&pretty_print=true&sortby=points desc&limit=%d&start=%d";
    if(start_index === undefined) {
        start_index = 0;
    }
    if(posts === undefined) {
        posts = [];
    }

    step(
        function() {
            requester.get(_s.sprintf(query_str, start_date.toISOString(), limit, start_index), this);
        },
        function(body) {
            var resp = JSON.parse(body);

            for(var result in resp.results) {
                if(!resp.results.hasOwnProperty(result)) continue;
                posts.push(resp.results[result]);
            }
            if(start_index + limit < max_posts) {
                refresh_data(start_index + limit, posts);
            } else {
                var not_stupid_posts = [];
                for(var post in posts) {
                    posts[post].item.permalink = "http://news.ycombinator.com/item?id=" + posts[post].item.id;
                    var d = new Date(posts[post].item.create_ts);

                    posts[post].item.rss_date = date_format_rss(d);
                    not_stupid_posts.push(posts[post].item);
                }
                setTimeout(
                    (function(cb) {
                        return function() {
                            cb(not_stupid_posts);
                        };
                    })(this),
                    0
                );
            }
        },
        function(posts) {
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
                            console.log(post.id);
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
                })(posts[post], group());
            }
        },
        function(err, results) {
            if(false) {
                client.end();
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
                    console.log(results);
                    if(results.rows[0].count == 0) {
                        client.query("insert into post_uses (select post_id, current_timestamp as use_date, $1 as use_tod from posts where age(creation_date) > '1 week')", ["bogus"], this);
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
                            "limit 25" +
                        ")",
                        [time_of_day, new Date().getUTCDay() + 1], // JS uses days starting at 0, postgres starting at 1
                        this
                    );
                },
                function(err, results) {
                    console.log(err);
                    console.log(results.rows.length);
                    console.log(results.rows);

                    client.query("END", this);
                },
                function(err, results) {
                },
                function() {
                    client.end();
                }
            );
        }
    );
};


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

var date_format_rss = function(d) {
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return _s.sprintf("%s, %02d %s %d %02d:%02d:%02d UTC",
        days[d.getUTCDay()],
        d.getUTCDate(),
        months[d.getUTCMonth()],
        d.getUTCFullYear(),
        d.getUTCHours(),
        d.getUTCMinutes(),
        d.getUTCSeconds()
    );
}

var percentile_filter = function(posts, threshold) {
    var culled_post_count = Math.round(posts.length * (1-threshold) + .5);  // Not sure what the .5 is for, but that's what Wikipedia says should be in there
    var culled_posts = posts.slice(0, culled_post_count);
    console.log(calc_point_range(culled_posts));

    return culled_posts;
}


var calc_point_range = function(posts) {
    return {
        min: + posts[posts.length-1].points,
        max: posts[0].points
    };
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

refresh_data();

//app.listen(process.env.VCAP_APP_PORT || 3000);
//console.log("Yay, started!");
