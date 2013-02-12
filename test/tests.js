require("../conf.js");

var step = require("step");

var hn = require("../lib/hn");

exports.stuff = function(beforeExit, assert) {
    // A subset of possible filter values is sufficient to verify it's working correctly
    var days = [1, 2, 3, 4, 5, 6, 7];
    var hours = [0, 6, 12, 18];
    var ranks = [1, 10, 25, 50, 100, 300];

    for(var day in days) {
        for(var hour in hours) {
            for(var rank in ranks) {
                (function(day, hour, rank) {
                    step(
                        function() {
                            hn.get_posts(day, hour, rank, this);
                        },
                        function(posts) {
                            console.log("Day: " + day.toString() + ", hour: " + hour.toString() + ", rank: " + rank.toString());

                            assert.notEqual(posts, undefined);
                            assert.notEqual(posts, null);

                            assert.equal(posts.length, rank);

                            for(var post in posts) {
                                assert.ok(posts[post].rank <= rank, "Max rank exceeded: max: " + posts[post].rank + ", actual: " + rank);

                                var date = new Date(posts[post].creation_date);
                                var test_date = new Date();

                                if(process.env.hnweekly_debug) {
                                    console.log("Testing: " + test_date.toString() + ", " + rank.toString());
                                }

                                while(test_date.getUTCDay() !== day-1) {
                                    test_date.setTime(test_date.getTime() - (1000 * 60 * 60 * 24));
                                }
                                test_date.setUTCHours(hour);
                                test_date.setUTCMinutes(0);
                                test_date.setUTCSeconds(0);
                                test_date.setUTCMilliseconds(0);
                                assert.ok(date <= test_date);
                            }
                        }
                    );
                })(days[day], hours[hour], ranks[rank]);
            }
        }
    }
}
