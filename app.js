var cons = require("consolidate");

var express = require("express");
var app = express();
app.use(require("connect").bodyParser());
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
    day = req.query.day || new Date().getDay();
    ts_range = calc_ts_range(day);

    get_data = function(start_index, posts) {
        if(posts === undefined) {
            console.log("Initing posts array");
            posts = [];
        }

        var limit = 100;
        var query_str = "http://api.thriftdb.com/api.hnsearch.com/items/_search?filter[fields][create_ts]=[%s TO %s]&pretty_print=true&sortby=points desc&limit=%d&start=%d";
        console.log(_s.sprintf(query_str, ts_range.start, ts_range.end, limit, start_index))
        requester.get(
            _s.sprintf(query_str, ts_range.start, ts_range.end, limit, start_index),
            function(body) {
                var resp = JSON.parse(body);
                console.log(resp.hits);
                console.log("start = " + start_index);

                for(result in resp.results) {
                    if(!resp.results.hasOwnProperty(result)) continue;
                    posts.push(resp.results[result]);
                }
                console.log("Total posts count: ", posts.length);
                if(start_index + limit <= 300) {  // HN Search limits us to 1000 hits
                    get_data(start_index + limit, posts);
                } else {
                    not_stupid_posts = [];
                    for(post in posts) {
                        not_stupid_posts.push(posts[post].item);
                    }
                    finish(not_stupid_posts, req, res);
                }
            }
        );
    };

    get_data(0)
});

finish = function(posts, req, res) {
    var culled_item_count = Math.round(posts.length * (1-req.query.threshold) + .5);  // Not sure what the .5 is for, but that's what Wikipedia says should be in there
    var culled_items = posts.slice(0, culled_item_count);
    console.log("Culled count is " + culled_item_count);
    console.log(calc_point_range(culled_items));

    res.render(
        "index",
        {posts: culled_items}
    );
}

calc_point_range = function(posts) {
    return {
        min: + posts[posts.length-1].points,
        max: posts[0].points
    };
}

calc_ts_range = function(day) {
    var end = new Date();
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
