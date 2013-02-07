"use strict";

try {
    require("./conf.js");
} catch(e) {
    console.log("Can't find conf.js, cannot proceed. It can be procured from the git repo you got the app from.");
    process.exit(1);
}

var fs = require("fs");

var step = require("step");
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

step(
    function() {
        fs.readdir("db_migrations", this.parallel());
        client.query("select max(version) max_version from db_upgrades", this.parallel());
    },
    function(err, files, results) {
        var max_version;
        if(err && err.code === "42P01") {
            max_version = 0;
        } else {
            max_version = results.rows[0].max_version;
        }

        var db_versions = parse_filenames(files);

        (function upgrade_version(db_versions, cb) {
            if(db_versions.length === 0) {
                setTimeout(cb, 0);
                return;
            }

            var this_file = db_versions[0];

            if(this_file.version <= max_version) {
                console.log("here");
                db_versions.shift();
                setTimeout(upgrade_version, 0, db_versions, cb);
                return;
            }

            process.stdout.write("Applying update " + this_file.version + "... ");
            step(
                function() {
                    fs.readFile("db_migrations/" + this_file.filename, this);
                },
                function(err, data) {
                    client.query(data.toString(), this);;
                },
                function(err, results) {
                    if(err) {
                        console.log("Cannot apply migration script");
                        console.log(err);
                        process.exit(1);
                    }

                    client.query(
                        "insert into db_upgrades values ($1, current_timestamp)",
                        [this_file.version],
                        this
                    );
                },
                function(err, data) {
                    if(err) {
                        console.log(err);
                        process.exit(1);
                    }

                    db_versions.shift();
                    console.log("Success!");
                    setTimeout(upgrade_version, 0, db_versions, cb);
                }
            );
        })(db_versions, this);
    },
    function() {
        client.end();
    }
);

var parse_filenames = function(files) {
    var versions = [];
    for(var file in files) {
        versions.push({
            version: parseInt(files[file].split(".", 1)),
            filename: files[file]
        });
    }

    versions.sort(function(a, b) {
        if(a.version == b.version) {
            console.log("Can't have two files with the same version number: " + a.filename + ", " + b.filename);
            process.exit(1);
        }
        return a.version < b.version ? -1 : 1;
    });

    return versions;
}
