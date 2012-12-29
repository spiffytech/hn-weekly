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

var threshold = .80;

app.get("/", function(req, res) {

    get_data = function(start_date, start_index, posts) {
        if(posts === undefined) {
            console.log("Initing posts array");
            posts = [];
        }

        var limit = 100;
        var query_str = "http://api.thriftdb.com/api.hnsearch.com/items/_search?filter[fields][create_ts]=[%sT00:00:00Z TO *]&pretty_print=true&sortby=points desc&limit=%d&start=%d";
        console.log(_s.sprintf(query_str, start_date, limit, start_index))
        requester.get(
            _s.sprintf(query_str, start_date, limit, start_index),
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
                    get_data(start_date, start_index + limit, posts);
                } else {
                    not_stupid_posts = [];
                    for(post in posts) {
                        not_stupid_posts.push(posts[post].item);
                    }
                    finish(not_stupid_posts, res);
                }
            }
        );
    };

    get_data("2012-12-21", 0)
});

finish = function(posts, res) {
    var culled_item_count = Math.round(posts.length * (1-threshold) + .5);  // Not sure what the .5 is for, but that's what Wikipedia says should be in there
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






recur = function(i) {
    i += 1;
    console.log(i);
    if(i == 5) return;
    setTimeout(function() {
        recur(i);
    }, 500);
}

//recur(0);
app.listen(3000);
console.log("Yay, started!");
