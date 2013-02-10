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
                                    [post.points, post.title, post.num_comments, post.id],
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
                    client.query(
                        "select count(*) from post_ranks",
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
                    db_timestamp = get_db_timestamp(new Date());
                    client.query(
                        "insert into post_ranks (" +
                            "select " +
                                "posts.post_id, " +
                                "row_number() over (order by points desc) as rank, " + 
                                "$1 as use_date " +
                            "from posts " +
                            "left outer join (" +
                                "select * from post_ranks " +
                                "where " +
                                    "to_char(use_date, 'D') = $2 " +
                                    "and to_char(use_hour, 'HH24') = $3 " +
                            ") as post_ranks " +
                            "on posts.post_id=post_ranks.post_id " +
                            "where post_ranks.post_id is null " +
                            "order by posts.points desc " +
                            "limit 1000" +
                        ")",
                        [time_of_day, db_timestamp.day, db_timestamp.hour()], 
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
        function(err, results) {
            var group = this.group();
            var db_timestamp = get_db_timestamp();
            var oneday = 1000 * 60 * 60 * 24;
            var oneweek = oneday * 7;
            for(
                var day = db_timestamp.date;
                day > new Date(db_timestamp.date.getTime() - oneweek);
                day = new Date(day.getTime() - oneday)
            ) {
                for(var hour = 0; hour < 24; hour++) {
                    var date = new Date(day);
                    date.setUTCHours(hour);
                    (function(date, group) {
                        client.query(
                            "insert into post_ranks " +
                                "(" +
                                    "select " +
                                        "post_id, " +
                                        "row_number() over (order by points desc) as rank, " +
                                        "$1 as use_date " +
                                    "from posts " +
                                    "where " +
                                        "age($1, creation_date) between '0 seconds' " +
                                        "and '1 week' " +
                                    "order by points desc " +
                                    "limit 1000" +
                                ")",
                                [date], group
                        );
                    })(date, group());
                }
            }
        },
        function(err, results) {
            setTimeout(cb, 0);
        }
    );
}


var get_db_timestamp = function(d) {
    if(d === undefined) {
        d = new Date();
    }

    d.setUTCMinutes(0);
    d.setUTCSeconds(0);
    d.setUTCMilliseconds(0);

    return {
        date: d,
        hour: d.getUTCHours(),
        day: d.getUTCDay() + 1  // JS uses days starting at 0, postgres starting at 1
    };
}
