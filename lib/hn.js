"use strict";

try {
    require("../conf.js");
} catch(e) {
    console.log("Can't find conf.js, cannot proceed. It can be procured from the git repo you got the app from.");
    process.exit(1);
}

var step = require("step");

var Requester = require("requester");
var requester = new Requester();

var _s = require("underscore.string");

var pg = require("pg");
var client = new pg.Client(_s.sprintf("postgres://%s:%s@%s:%s/%s", 
    process.env.hnweekly_postgres_user,
    process.env.hnweekly_postgres_password,
    process.env.hnweekly_postgres_host,
    process.env.hnweekly_postgres_port,
    process.env.hnweekly_postgres_db
));
client.connect();

exports.refresh_data = function() {
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


exports.prune_data = function() {
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

exports.hour_from_time_of_day = function(time_of_day) {
    if(time_of_day == "midnight") {
        return 0;
    } else if(time_of_day == "morning") {
        return 6;
    } else if(time_of_day == "noon") {
        return 12;
    } else {
        return 18;
    }
}
