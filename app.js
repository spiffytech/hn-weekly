"use strict";

var cons = require("consolidate");

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
    max: 1024 * 1024 * 5,
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
    console.log("Day: " + date_format_rss(new Date(calc_ts_range(day).end)));
    console.log("Threshold: " + threshold);

    get_data(day, 0, function(posts) {
        var culled_posts = posts.slice(0, threshold);
        callback(culled_posts);
    });
}

var get_data = function(day, start_index, callback, posts) {
    var ts_range = calc_ts_range(day);
    var limit = 100;
    var query_str = "http://api.thriftdb.com/api.hnsearch.com/items/_search?filter[fields][create_ts]=[%s TO %s]&pretty_print=true&sortby=points desc&limit=%d&start=%d";
    if(posts === undefined) {
        posts = [];
    }

    var cached_posts = cache.get("day-" + day);
    if(cached_posts) {
        console.log("Cache hit: day " + day);
        callback(cached_posts);
        return;
    }

    requester.get(
        _s.sprintf(query_str, ts_range.start, ts_range.end, limit, start_index),
        function(body) {
            var resp = JSON.parse(body);

            for(var result in resp.results) {
                if(!resp.results.hasOwnProperty(result)) continue;
                posts.push(resp.results[result]);
            }
            if(start_index + limit <= 1000) {  // HN Search limits us to 1000 hits
                get_data(day, start_index + limit, callback, posts);
            } else {
                var not_stupid_posts = [];
                for(var post in posts) {
                    posts[post].item.permalink = "http://news.ycombinator.com/item?id=" + posts[post].item.id;
                    var d = new Date(posts[post].item.create_ts);

                    posts[post].item.rss_date = date_format_rss(d);
                    not_stupid_posts.push(posts[post].item);
                }
                console.log("Cache miss: day " + day);
                if(within_cache_intelval(day)) {
                    console.log("Data size: " + (JSON.stringify(not_stupid_posts).length / 1024) / 1024);
                    cache.set("day-" + day, not_stupid_posts);
                }
                callback(not_stupid_posts);
            }
        }
    );
};

var validate_inputs = function(req, res) {
    if(req.query.threshold) {
        if(req.query.threshold <= 0 || req.query.threshold > 1000) {
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


app.listen(process.env.VCAP_APP_PORT || 3000);
console.log("Yay, started!");
