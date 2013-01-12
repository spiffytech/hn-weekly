drop table if exists db_upgrades;
drop table if exists post_uses;
drop table if exists posts;

create table db_upgrades (version integer primary key, upgrade_date timestamp);
create table posts (post_id integer primary key, points integer, title text, domain text, username text, url text, num_comments integer, creation_date timestamp);
create table post_uses (post_id integer, use_date timestamp, use_tod text, FOREIGN KEY (post_id) REFERENCES posts (post_id) ON DELETE cascade, check (use_tod in ('midnight', 'morning', 'noon', 'evening', 'bogus')), primary key (post_id, use_date, use_tod));
