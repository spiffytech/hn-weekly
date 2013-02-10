"use strict";

try {
    require("./conf.js");
} catch(e) {
    console.log("Can't find conf.js, cannot proceed. It can be procured from the git repo you got the app from.");
    process.exit(1);
}

var hn = require("./lib/hn.js");

var _s = require("underscore.string");
require("date-utils");

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
        hn.refresh_data();
        hn.prune_data();
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

app.get("/", function(req, res) {
    res.render(
        "index",
        {
            ga_tracking_code: process.env.hnweekly_google_analytics_id,
            contact_address: process.env.hnweekly_contact_address,
            partials: {
                header: "header",
                footer: "footer"
            }
        }
    );
});

app.get("/about", function(req, res) {
    res.render(
        "about",
        {
            title: "About - ",
            ga_tracking_code: process.env.hnweekly_google_analytics_id,
            contact_address: process.env.hnweekly_contact_address,
            partials: {
                header: "header",
                footer: "footer"
            }
        }
    );
});

app.get("/posts.json", function(req, res) {
    ga.trackPage(req.url);
    try {
        validate_inputs(req, res);
    } catch(e) {
        return;
    }

    var params = get_parameters(req);
    var date_range = calc_ts_range(params.day, params.hour);
    date_range = {
        start: date_range.start.toUTCString(),
        end: date_range.end.toUTCString(),
    }


    do_stuff(params.day, params.hour, params.threshold, function(posts) {

        res.send({
            posts: posts,
            num_posts: posts.length,
            date_range: date_range
        });
    });
});

app.get("/feed.xml", function(req, res) {
    ga.trackPage(req.url);
    try {
        validate_inputs(req, res);
    } catch(e) {
        return;
    }

    var params = get_parameters(req);
    do_stuff(params.day, params.hour, params.threshold, function(posts) {
        res.type("application/rss+xml");
        res.render(
            "feed",
            {posts: posts}
        );
    });
});

var do_stuff = function(day, hour, threshold, callback) {
    //var vals = cache.values();
    //for(var v in vals) console.log(JSON.stringify(vals[v]).length / (1024 * 1024));

    step(
        function() {
            client.query(
                "select * from posts " + 
                "join post_ranks on posts.post_id=post_ranks.post_id " +
                "where " +
                    "to_char(use_date, 'D') = $1 " +
                    "and to_char(use_date, 'HH24') = $2 " +
                    "and post_ranks.rank <= $3 " +
                "order by posts.points desc ",
                [day, _s.sprintf("%02d", hour), threshold],
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

    if(req.query.hour) {
        if(req.query.hour < 0 || req.query.hour > 23) {
            res.send(404, {error: "Hour out of range"});
            throw "Hour out of range";
        }
    }
}


var get_parameters = function(req) {
    var threshold = parseInt(req.query.threshold) || 25;
    var day = parseInt(req.query.day) + 1 || new Date().getUTCDay() + 1;
    var hour = parseInt(req.query.hour) || 0;

    return {
        day: day,
        hour: hour,
        threshold: threshold,
    };
}

/*
 * Returns the most recent date range for a given day-of-week and hour
*/
var calc_ts_range = function(day, hour) {
    var end = new Date();
    end.setUTCHours(hour);
    end.setUTCMinutes(0);
    end.setUTCSeconds(0);
    end.setUTCMilliseconds(0);
    while(end.getUTCDay() != day-1) {  // -1 is because the day is +1'd by get_parameters() before being passed here
        end.setTime(end.getTime() - 1000 * 60 * 60 * 24);
    }

    var start = new Date();
    start.setTime(end.getTime() - 1000 * 60 * 60 * 24 * 7);

    return {
        start: start,
        end: end
    };
}


process.on("SIGINT", function() {
    console.warn("Cleaning up...");
    client.end();
    process.exit(0);
});

hn.refresh_data();

app.listen(process.env.VCAP_APP_PORT || 4000);
console.log("Yay, started!");
