const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const dbPath = path.join(__dirname, "twitterClone.db");
const app = express();
app.use(express.json());
let db;

const dbConnection = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () => {
      console.log("The server started at http://localhost:3000/");
    });
  } catch (err) {
    console.log(`Database error is ${err.message}`);
  }
};

dbConnection();

// AUTHORIZATION

const authorization = (request, response, next) => {
  const { tweet } = request.body;
  const { tweetId } = request.params;
  let jwtToken;

  const authorHeaders = request.headers["authorization"];

  if (authorHeaders !== undefined) {
    jwtToken = authorHeaders.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "RAF", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.payload = payload;
        request.tweet = tweet;
        request.tweetId = tweetId;
        next();
      }
    });
  }
};

// 1. REGISTER USER API

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const userCheck = `select * from user where username = "${username}";`;
  const hashedPassword = await bcrypt.hash(password, 10);
  const dbUser = await db.get(userCheck);

  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUserQuery = `insert into user (username, password, name, gender)
                                    values ("${username}", "${hashedPassword}", "${name}", "${gender}");`;
      await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// 2. LOGIN API

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUser = `select * from user where username = "${username}";`;
  const dbUser = await db.get(selectUser);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const passwordCheck = await bcrypt.compare(password, dbUser.password);

    if (passwordCheck !== true) {
      response.status(400);
      response.send("Invalid password");
    } else {
      let jwtToken = jwt.sign(dbUser, "RAF");
      response.send({ jwtToken });
    }
  }
});

// 3. USER TWEET FEED

app.get("/user/tweets/feed/", authorization, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  const getTweetFeedQuery = `select username, tweet, date_time as dateTime
                            from follower INNER JOIN tweet ON follower.following_user_id = 
                            tweet.user_id INNER JOIN user ON user.user_id = 
                            follower.following_user_id WHERE follower.follower_user_id = ${user_id}
                            ORDER BY date_time DESC LIMIT 4;`;
  const tweetArray = await db.all(getTweetFeedQuery);
  response.send(tweetArray);
});

// 4. GET USER FOLLOWING

app.get("/user/following/", authorization, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  const userFollowingQuery = `select name from user INNER JOIN follower on
                                user.user_id = follower.following_user_id
                                where follower.follower_user_id = ${user_id};`;
  const userFollowersArr = await db.all(userFollowingQuery);
  response.send(userFollowersArr);
});

// 5. USER FOLLOWER API

app.get("/user/followers/", authorization, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  const usersFollowingQuery = `select name from user INNER JOIN follower on user.user_id = 
                                follower.follower_user_id where follower.following_user_id = ${user_id};`;
  const followerQueryArr = await db.all(usersFollowingQuery);
  response.send(followerQueryArr);
});

// 6. TWEETS API

app.get("/tweets/:tweetId/", authorization, async (request, response) => {
  const { tweetId } = request;
  const { payload } = request;
  const { user_id, name, username, gender } = payload;

  const tweetQuery = `select * from tweet where tweet_id = ${tweetId};`;
  const tweetResult = await db.get(tweetQuery);

  const userFollowersQuery = `select * from follower INNER JOIN user on user.user_id
                                = follower.following_user_id WHERE follower.follower_user_id = ${user_id};`;
  const userFollowers = await db.all(userFollowersQuery);

  if (
    userFollowers.some((item) => item.following_user_id === tweetResult.user_id)
  ) {
    const tweetDetailsQuery = `select tweet, count(distinct(like.like_id)) as likes,
                                count(distinct(reply.reply_id)) as replies,
                                tweet.date_time as dateTime FROM
                                tweet INNER JOIN like on tweet.tweet_id = like.tweet_id INNER JOIN reply on reply.tweet_id = tweet.tweet_id
                                WHERE tweet.tweet_id = ${tweetId} AND tweet.user_id = ${userFollowers[0].user_id}`;
    const tweetDetails = await db.get(tweetDetailsQuery);
    response.send(tweetDetails);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

// 7. TWEET LIKES

app.get("/tweets/:tweetId/likes/", authorization, async (request, response) => {
  const { tweetId } = request;
  const { payload } = request;
  const { user_id, name, username, gender } = payload;

  const getLikedUserQuery = `select * from follower INNER JOIN tweet on tweet.user_id = follower.following_user_id
                            INNER JOIN like on like.tweet_id = tweet.tweet_id INNER JOIN user ON user.user_id = like.user_id
                            WHERE tweet.tweet_id = ${tweetId} and follower.follower_user_id = ${user_id};`;
  const likedUsers = await db.all(getLikedUserQuery);

  if (likedUsers.length !== 0) {
    let likes = [];
    const namesArray = (likeUsers) => {
      for (let item of likeUsers) {
        likes.push(item.username);
      }
    };
    namesArray(likedUsers);
    response.send({ likes });
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

// API 8

app.get(
  "/tweets/:tweetId/replies/",
  authorization,
  async (request, response) => {
    const { tweetId } = request;
    const { payload } = request;
    const { user_id, name, username, gender } = payload;

    const getRepliedUserQuery = `select * from follower INNER JOIN tweet on tweet.user_id = follower.following_user_id
                                INNER JOIN reply ON reply.tweet_id = tweet.tweet_id INNER JOIN user ON user.user_id = reply.user_id
                                WHERE tweet.tweet_id = ${tweetId} AND follower.follower_user_id = ${user_id};`;
    const repliedUsers = await db.all(getRepliedUserQuery);

    if (repliedUsers.length !== 0) {
      let replies = [];
      const getNamesArray = (users) => {
        for (let user of users) {
          let object = {
            name: user.name,
            reply: user.reply,
          };
          replies.push(object);
        }
      };
      getNamesArray(repliedUsers);
      response.send({ replies });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

// API 9

app.get("/user/tweets/", authorization, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;

  const getTweetDetailsQuery = `select tweet.tweet as tweet,
                                COUNT(DISTINCT(like.like_id)) as likes,
                                count(distinct(reply.reply_id)) as replies,
                                tweet.date_time as dateTime FROM user
                                INNER JOIN tweet on user.user_id = tweet.user_id INNER JOIN like on like.tweet_id = tweet.tweet_id
                                INNER JOIN reply on reply.tweet_id = tweet.tweet_id
                                WHERE user.user_id = ${user_id}
                                group by tweet.tweet_id;
                                `;
  const tweetDetails = await db.all(getTweetDetailsQuery);
  response.send(tweetDetails);
});

// API 10

app.post("/user/tweets/", authorization, async (request, response) => {
  const { tweet } = request;
  const { tweetId } = request;
  const { payload } = request;
  const { user_id, name, username, gender } = payload;

  const postTweetQuery = `insert into tweet (tweet, user_id) values ("${tweet}", ${user_id});`;
  await db.run(postTweetQuery);
  response.send("Created a Tweet");
});

// API 11

app.delete("/tweets/:tweetId/", authorization, async (request, response) => {
  const { tweetId } = request;
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  const selectUserQuery = `select * from tweet where tweet.user_id = ${user_id} and
                            tweet.tweet_id = ${tweetId};`;
  const tweetUser = await db.all(selectUserQuery);

  if (tweetUser.length !== 0) {
    const deleteTweetQuery = `delete from tweet where tweet.user_id = ${user_id} and tweet.tweet_id = ${tweetId};`;
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

module.exports = app;
