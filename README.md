HN Weekly
=========

Weekly digest of the best of Hacker News from the past week.

Well, "past week" is a little bit fuzzy. Technically, the algorithm is "the top stories from sometime in the past two weeks that weren't included in last week's roundup", which works out *almost* the same. The difference is this ensures that something submitted just a few minutes before the weekly cutoff, when it only has a few points, gets shown the next week once it's gotten tons of points.




Requirements
============

- Postgresql

    - Your postgres installation must be set to use UTC, else the program will become very confused


Install
=======
- Clone the repo

- Look at conf.js, then create conf_override.js, overriding the values for your database access, site name, etc.

    - conf_override.js is not checked into the git repo, so putting your settings in there means you don't have conflicts when you pull updates from upstream

- `npm install`

- `node db_migration.js`

- `node app.js`
