HN Weekly
=========

Weekly digest of the best of Hacker News from the past week.

Well, "past week" is a little bit fuzzy. Technically, the algorithm is "the top stories submitted sometime in the past two weeks that weren't included in last week's roundup", which works out *almost* the same. The difference is this ensures that something submitted just a few minutes before the weekly cutoff, when it only has a few points, gets shown the next week once it's gotten tons of points.




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


Architecture
============

HN Weekly stores all recent high-ranking HN posts in a database, along with what each post's rank was at any given time point that you're allowed to request data from. Additionally, this is multiplied by all possible "top N" values you're allowed to request. That's a lot of data! 

Why do we need that much data? Originally, HN Weekly was coded as an elegantly-stateless app. Each request queried HN Search, ordered posts by points, applied the "top N" cutoff, cached, and returned that to the user. 

The problem was posts would barely miss the cutoff, but accrue more points, and eventually what used to be post #26 would float up to #25, pushing #25 down. That meant that sometime after your RSS reader had retrieved the top 25 posts for the week, you would get a couple more posts delivered sometime in the next day, violating both the "top N" goal, and the "once a week" goal. 

Thus, I had to store how highly each post was ranked for each time period, so I knew what the top 25 posts for Sunday night were on Sunday night. But that produced a new problem: now that I stored how highly each post in the DB was ranked for each time period, I didn't have a way to say "this post was #75 last week, but in the meantime it accrued 10 billion points, so I should show it". So to handle /that/, I store each post's rank for each possible date window, for each possible rank I allow users to select. That way, I can query the database for all posts that are top 25 now, but were not in last week's top 25. It's a lot of stuff to store, but it works. 
