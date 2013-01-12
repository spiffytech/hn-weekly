"use strict";

try {
    require("./conf.js");
} catch(e) {
    console.log("Can't find conf.js, cannot proceed. It can be procured from the git repo you got the app from.");
    process.exit(1);
}

var hn = require("./lib/hn.js");

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

    do_stuff(req, function(posts) {
        res.send({
            posts: posts,
            num_posts: posts.length
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


process.on("SIGINT", function() {
    console.warn("Cleaning up...");
    client.end();
    process.exit(0);
});

hn.refresh_data();

app.listen(process.env.VCAP_APP_PORT || 3000);
console.log("Yay, started!");
