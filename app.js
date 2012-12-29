var step = require("step");

var Requester = require("requester");
requester = new Requester();

var _s = require("underscore.string");

var threshold = .80;

get_data = function(start_date, start_index, results) {
    if(results === undefined) {
        console.log("Initing results array");
        results = [];
    }

    limit = 100;
    query_str = "http://api.thriftdb.com/api.hnsearch.com/items/_search?filter[fields][create_ts]=[%sT00:00:00Z TO *]&pretty_print=true&sortby=points desc&limit=%d&start=%d";
    console.log(_s.sprintf(query_str, start_date, limit, start_index))
    requester.get(
        _s.sprintf(query_str, start_date, limit, start_index),
        function(body) {
            resp = JSON.parse(body);
            console.log(resp.hits);
            console.log("start = " + start_index);

            for(result in resp.results) {
                if(!resp.results.hasOwnProperty(result)) continue;
                results.push(resp.results[result]);
            }
            console.log("Total results count: ", results.length);
            if(start_index + limit <= 300) {
                get_data(start_date, start_index + limit, results);
            } else {
                finish(results);
            }
        }
    );
}

finish = function(results) {
    console.log("Ended with " + results.length + " results");
    culled_item_count = Math.floor(results.length * (1-threshold));
    culled_items = results.slice(0, culled_item_count);
    console.log("Culled count is " + culled_item_count);
    console.log(calc_point_range(culled_items));
}

calc_point_range = function(results) {
    return {
        min: + results[results.length-1].item.points,
        max: results[0].item.points
    };
}

get_data("2012-12-21", 0)





recur = function(i) {
    i += 1;
    console.log(i);
    if(i == 5) return;
    setTimeout(function() {
        recur(i);
    }, 500);
}

//recur(0);
