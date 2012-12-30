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

var Requester = require("requester");
requester = new Requester();

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

app.get("/posts.json", function(req, res) {
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
    do_stuff(req, function(posts) {
        res.render(
            "feed",
            {posts: posts}
        );
    });
});

do_stuff = function(req, callback) {
    var day = req.query.day || new Date().getDay();
    var threshold = req.query.threshold || .9;
    console.log("Day: " + date_format_rss(new Date(calc_ts_range(day).end)));
    console.log("Threshold: " + threshold);

    get_data(day, 0, function(posts) {
        var culled_posts = percentile_filter(posts, threshold);
        callback(culled_posts);
    });
}

get_data = function(day, start_index, callback, posts) {
    var ts_range = calc_ts_range(day);
    var limit = 100;
    var query_str = "http://api.thriftdb.com/api.hnsearch.com/items/_search?filter[fields][create_ts]=[%s TO %s]&pretty_print=true&sortby=points desc&limit=%d&start=%d";
    if(posts === undefined) {
        posts = [];
    }

    requester.get(
        _s.sprintf(query_str, ts_range.start, ts_range.end, limit, start_index),
        function(body) {
            var resp = JSON.parse(body);

            for(result in resp.results) {
                if(!resp.results.hasOwnProperty(result)) continue;
                posts.push(resp.results[result]);
            }
            if(start_index + limit <= 300) {  // HN Search limits us to 1000 hits
                get_data(day, start_index + limit, callback, posts);
            } else {
                var not_stupid_posts = [];
                for(var post in posts) {
                    posts[post].item.permalink = "http://news.ycombinator.com/item?id=" + posts[post].item.id;
                    var d = new Date(posts[post].item.create_ts);

                    posts[post].item.rss_date = date_format_rss(d);
                    not_stupid_posts.push(posts[post].item);
                }
                callback(not_stupid_posts);
            }
        }
    );
};

date_format_rss = function(d) {
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

percentile_filter = function(posts, threshold) {
    var culled_post_count = Math.round(posts.length * (1-threshold) + .5);  // Not sure what the .5 is for, but that's what Wikipedia says should be in there
    var culled_posts = posts.slice(0, culled_post_count);
    console.log(calc_point_range(culled_posts));

    return culled_posts;
}


calc_point_range = function(posts) {
    return {
        min: + posts[posts.length-1].points,
        max: posts[0].points
    };
}


calc_ts_range = function(day) {
    var end = new Date();
    end.setUTCHours(0);
    end.setUTCMinutes(0);
    end.setUTCMilliseconds(0);
    while(end.getDay() != day) {
        end.setDate(end.getDate() - 1);
    }

    var start = new Date();
    start.setDate(end.getDate() - 7);

    return {
        start: start.toISOString(),
        end: end.toISOString()
    };
}


app.listen(3000);
console.log("Yay, started!");
