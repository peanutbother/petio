const Promise = require("bluebird");
const xmlParser = require("xml-js");
const Library = require("../models/library");
const Movie = require("../models/movie");
const Music = require("../models/artist");
const Show = require("../models/show");
const User = require("../models/user");
const Request = require("../models/request");
const Profile = require("../models/profile");
const Mailer = require("../mail/mailer");
const getConfig = require("../util/config");
const processRequest = require("../requests/process");
const logger = require("../util/logger");
const Discord = require("../notifications/discord");
const { showLookup } = require("../tmdb/show");
const bcrypt = require("bcryptjs");
const axios = require("axios");

class LibraryUpdate {
  constructor() {
    this.config = getConfig();
    this.mailer = [];
    this.tmdb = "https://api.themoviedb.org/3/";
    this.full = true;
  }

  async partial() {
    logger.log("info", `LIB CRON: Running Partial`);
    this.full = false;
    let recent = false;
    try {
      await this.updateFriends();
      recent = await this.getRecent();
    } catch (err) {
      logger.log(
        "warn",
        `LIB CRON: Partial scan failed - unable to get recent`
      );
      logger.log({ level: "error", message: err });
      return;
    }
    let matched = {};

    await Promise.map(
      Object.keys(recent.Metadata),
      async (i) => {
        let obj = recent.Metadata[i];

        if (obj.type === "movie") {
          if (!matched[obj.ratingKey]) {
            matched[obj.ratingKey] = true;
            await this.saveMovie(obj);
            logger.log("info", `LIB CRON: Partial scan - ${obj.title}`);
          }
        } else if (obj.type === "artist") {
          if (!matched[obj.ratingKey]) {
            matched[obj.ratingKey] = true;
            await this.saveMusic(obj);
          }
        } else if (obj.type === "show") {
          if (matched[obj.ratingKey]) {
            matched[obj.ratingKey] = true;
            await this.saveShow(obj);
            logger.log("info", `LIB CRON: Partial scan - ${obj.title}`);
          }
        } else if (obj.type === "season") {
          if (!matched[obj.parentRatingKey]) {
            matched[obj.parentRatingKey] = true;
            let parent = {
              ratingKey: obj.parentRatingKey,
              guid: obj.parentGuid,
              key: obj.parentKey,
              type: "show",
              title: obj.parentTitle,
              contentRating: "",
              summary: "",
              index: obj.index,
              rating: "",
              year: "",
              thumb: "",
              art: "",
              banner: "",
              theme: "",
              duration: "",
              originallyAvailableAt: "",
              leafCount: "",
              viewedLeafCount: "",
              childCount: "",
              addedAt: "",
              updatedAt: "",
              Genre: "",
              studio: "",
              titleSort: "",
            };

            await this.saveShow(parent);
            logger.log(
              "info",
              `LIB CRON: Partial scan - ${parent.title} - Built from series`
            );
          }
        } else {
          logger.log(
            "warn",
            `LIB CRON: Partial scan type not found - ${obj.type}`
          );
        }
      },
      { concurrency: 10 }
    );
    this.execMail();
    logger.log("info", "LIB CRON: Partial Scan Complete");
    return;
  }

  async scan() {
    logger.log("info", `LIB CRON: Running Full`);
    await this.createAdmin();
    await this.updateFriends();
    let libraries = false;
    try {
      libraries = await this.getLibraries();
    } catch (err) {
      logger.log("error", `LIB CRON: Error`);
      logger.log({ level: "error", message: err });
    }

    if (libraries) {
      await this.saveLibraries(libraries);
      await this.updateLibraryContent(libraries);
      this.execMail();
      logger.log("info", "LIB CRON: Full Scan Complete");
      this.checkOldRequests();
    } else {
      logger.log("warn", "Couldn't update libraries");
    }
  }

  async createAdmin() {
    let adminFound = await User.findOne({
      id: this.config.adminId,
    });
    if (!adminFound) {
      logger.log("info", "LIB CRON: Creating admin user");
      try {
        let adminData = new User({
          id: this.config.adminId,
          email: this.config.adminEmail,
          thumb: this.config.adminThumb,
          title: this.config.adminDisplayName,
          nameLower: this.config.adminDisplayName.toLowerCase(),
          username: this.config.adminUsername,
          password:
            this.config.adminPass.substring(0, 3) === "$2a"
              ? this.config.adminPass
              : bcrypt.hashSync(this.config.adminPass, 10),
          altId: 1,
          role: "admin",
        });
        await adminData.save();
      } catch (err) {
        logger.log("error", `LIB CRON: Error creating admin user`);
        logger.log({ level: "error", message: err });
      }
    } else {
      try {
        logger.log(
          "info",
          `LIB CRON: Admin Updating ${this.config.adminDisplayName}`
        );
        adminFound.email = this.config.adminEmail;
        adminFound.thumb = this.config.adminThumb;
        adminFound.title = this.config.adminDisplayName;
        adminFound.nameLower = this.config.adminDisplayName.toLowerCase();
        adminFound.username = this.config.adminUsername;
        if (this.config.adminPass.substring(0, 3) !== "$2a")
          adminFound.password = bcrypt.hashSync(this.config.adminPass, 10);
        await adminFound.save();
        logger.log(
          "info",
          `LIB CRON: Admin Updated ${this.config.adminDisplayName}`
        );
      } catch (err) {
        logger.log("error", `LIB CRON: Admin Update Failed ${obj.title}`);
        logger.log({ level: "error", message: err });
      }
    }
  }

  async getLibraries() {
    let url = `${this.config.plexProtocol}://${this.config.plexIp}:${this.config.plexPort}/library/sections/?X-Plex-Token=${this.config.plexToken}`;
    try {
      let res = await axios.get(url);
      logger.log("info", "LIB CRON: Found Libraries");
      return res.data.MediaContainer;
    } catch (e) {
      logger.log("warn", "LIB CRON: Library update failed!");
      throw e;
    }
  }

  async getRecent() {
    let url = `${this.config.plexProtocol}://${this.config.plexIp}:${this.config.plexPort}/library/recentlyAdded/?X-Plex-Token=${this.config.plexToken}`;
    try {
      let res = await axios.get(url);
      logger.log("info", "LIB CRON: Recently Added received");
      return res.data.MediaContainer;
    } catch {
      logger.log("warn", "LIB CRON: Recently added failed!");
      throw "Recently added failed";
    }
  }

  async saveLibraries(libraries) {
    await Promise.all(
      libraries.Directory.map(async (lib) => {
        await this.saveLibrary(lib);
      })
    );
  }

  async saveLibrary(lib) {
    let libraryItem = false;
    try {
      libraryItem = await Library.findOne({ uuid: lib.uuid });
    } catch {
      logger.log("info", "LIB CRON: Library Not found, attempting to create");
    }
    if (!libraryItem) {
      try {
        let newLibrary = new Library({
          allowSync: lib.allowSync,
          art: lib.art,
          composite: lib.composite,
          filters: lib.filters,
          refreshing: lib.refreshing,
          thumb: lib.thumb,
          key: lib.key,
          type: lib.type,
          title: lib.title,
          agent: lib.agent,
          scanner: lib.scanner,
          language: lib.language,
          uuid: lib.uuid,
          updatedAt: lib.updatedAt,
          createdAt: lib.createdAt,
          scannedAt: lib.scannedAt,
          content: lib.content,
          directory: lib.directory,
          contentChangedAt: lib.contentChangedAt,
          hidden: lib.hidden,
        });
        libraryItem = await newLibrary.save();
      } catch (err) {
        logger.log("error", `LIB CRON: Error`);
        logger.log({ level: "error", message: err });
      }
    } else {
      let updatedLibraryItem = false;
      try {
        updatedLibraryItem = await Library.updateOne(
          { uuid: lib.uuid },
          {
            $set: {
              allowSync: lib.allowSync,
              art: lib.art,
              composite: lib.composite,
              filters: lib.filters,
              refreshing: lib.refreshing,
              thumb: lib.thumb,
              key: lib.key,
              type: lib.type,
              title: lib.title,
              agent: lib.agent,
              scanner: lib.scanner,
              language: lib.language,
              uuid: lib.uuid,
              updatedAt: lib.updatedAt,
              createdAt: lib.createdAt,
              scannedAt: lib.scannedAt,
              content: lib.content,
              directory: lib.directory,
              contentChangedAt: lib.contentChangedAt,
              hidden: lib.hidden,
            },
          },
          { useFindAndModify: false }
        );
      } catch (err) {
        logger.log("error", `LIB CRON: Error`);
        logger.log({ level: "error", message: err });
      }
      if (updatedLibraryItem) {
        logger.log("info", "LIB CRON: Library Updated " + lib.title);
      }
    }
  }

  async updateLibraryContent(libraries) {
    for (let l in libraries.Directory) {
      let lib = libraries.Directory[l];
      try {
        let libContent = await this.getLibrary(lib.key);
        await Promise.map(
          Object.keys(libContent.Metadata),
          async (item) => {
            let obj = libContent.Metadata[item];
            if (obj.type === "movie") {
              await this.saveMovie(obj);
            } else if (obj.type === "artist") {
              await this.saveMusic(obj);
            } else if (obj.type === "show") {
              await this.saveShow(obj);
            } else {
              logger.log("info", `LIB CRON: Unknown media type - ${obj.type}`);
            }
          },
          { concurrency: 30 }
        );
      } catch (err) {
        logger.log("error", `LIB CRON: Unable to get library content`);
        logger.log({ level: "error", message: err });
      }
    }
  }

  async getLibrary(id) {
    let url = `${this.config.plexProtocol}://${this.config.plexIp}:${this.config.plexPort}/library/sections/${id}/all?X-Plex-Token=${this.config.plexToken}`;
    try {
      let res = await axios.get(url);
      return res.data.MediaContainer;
    } catch (e) {
      throw "Unable to get library content";
    }
  }

  async getMeta(id) {
    let url = `${this.config.plexProtocol}://${this.config.plexIp}:${this.config.plexPort}/library/metadata/${id}?X-Plex-Token=${this.config.plexToken}`;
    try {
      let res = await axios.get(url);
      return res.data.MediaContainer.Metadata[0];
    } catch (e) {
      throw "Unable to get meta";
    }
  }

  async saveMovie(movieObj) {
    let movieDb = false;
    try {
      movieDb = await Movie.findOne({
        ratingKey: parseInt(movieObj.ratingKey),
      });
    } catch {
      movieDb = false;
    }

    let idSource = movieObj.guid
      .replace("com.plexapp.agents.", "")
      .split("://")[0];
    let externalId = false;
    let externalIds = {};
    if (idSource === "local" || idSource === "none") {
      logger.verbose(
        `LIB CRON: Item skipped :: Not matched / local only - ${movieObj.title}`
      );
      return;
    }
    if (idSource === "plex") {
      let title = movieObj.title;
      try {
        movieObj = await this.getMeta(movieObj.ratingKey);
        for (let guid of movieObj.Guid) {
          let source = guid.id.split("://");
          externalIds[source[0] + "_id"] = source[1];
        }
      } catch (err) {
        logger.log("warn", `LIB CRON: Unable to fetch meta for ${title}`);
        return;
      }
    } else {
      if (idSource === "themoviedb") {
        idSource = "tmdb";
      }

      try {
        externalId = movieObj.guid
          .replace("com.plexapp.agents.", "")
          .split("://")[1]
          .split("?")[0];

        externalIds = await this.externalIdMovie(externalId);
        externalIds.tmdb_id = externalIds.id ? externalIds.id : false;
      } catch (err) {
        if (!externalId) {
          logger.log(
            "warn",
            `LIB CRON: Error - unable to parse id source from: ${movieObj.guid} - Movie: ${movieObj.title}`
          );
        } else {
          logger.log({ level: "error", message: err });
        }
      }
    }

    if (!movieDb) {
      try {
        let newMovie = new Movie({
          title: movieObj.title,
          ratingKey: movieObj.ratingKey,
          key: movieObj.key,
          guid: movieObj.guid,
          studio: movieObj.studio,
          type: movieObj.type,
          titleSort: movieObj.titleSort,
          contentRating: movieObj.contentRating,
          summary: movieObj.summary,
          rating: movieObj.rating,
          year: movieObj.year,
          tagline: movieObj.tagline,
          thumb: movieObj.thumb,
          art: movieObj.art,
          duration: movieObj.duration,
          originallyAvailableAt: movieObj.originallyAvailableAt,
          addedAt: movieObj.addedAt,
          updatedAt: movieObj.updatedAt,
          primaryExtraKey: movieObj.primaryExtraKey,
          ratingImage: movieObj.ratingImage,
          Media: movieObj.Media,
          Genre: movieObj.Genre,
          Director: movieObj.Director,
          Writer: movieObj.Writer,
          Country: movieObj.Country,
          Role: movieObj.Role,
          idSource: idSource,
          externalId: externalId,
          imdb_id: externalIds.hasOwnProperty("imdb_id")
            ? externalIds.imdb_id
            : false,
          tmdb_id: externalIds.hasOwnProperty("tmdb_id")
            ? externalIds.tmdb_id
            : false,
        });
        if (!externalIds.tmdb_id) {
          logger.log(
            "warn",
            `LIB CRON: Movie couldn't be matched - ${movieObj.title} - try rematching in Plex`
          );
        } else {
          movieDb = await newMovie.save();
          await this.mailAdded(movieObj, newMovie.tmdb_id);
          logger.log("info", `LIB CRON: Movie Added - ${movieObj.title}`);
        }
      } catch (err) {
        logger.log("warn", `LIB CRON: Error`);
        logger.log({ level: "error", message: err });
      }
    } else {
      try {
        if (externalIds.tmdb_id) {
          await Movie.findOneAndUpdate(
            {
              ratingKey: movieObj.ratingKey,
            },
            {
              $set: {
                title: movieObj.title,
                ratingKey: movieObj.ratingKey,
                key: movieObj.key,
                guid: movieObj.guid,
                studio: movieObj.studio,
                type: movieObj.type,
                titleSort: movieObj.titleSort,
                contentRating: movieObj.contentRating,
                summary: movieObj.summary,
                rating: movieObj.rating,
                year: movieObj.year,
                tagline: movieObj.tagline,
                thumb: movieObj.thumb,
                art: movieObj.art,
                duration: movieObj.duration,
                originallyAvailableAt: movieObj.originallyAvailableAt,
                addedAt: movieObj.addedAt,
                updatedAt: movieObj.updatedAt,
                primaryExtraKey: movieObj.primaryExtraKey,
                ratingImage: movieObj.ratingImage,
                Media: movieObj.Media,
                Genre: movieObj.Genre,
                Director: movieObj.Director,
                Writer: movieObj.Writer,
                Country: movieObj.Country,
                Role: movieObj.Role,
                idSource: idSource,
                externalId: externalId,
                imdb_id: externalIds.hasOwnProperty("imdb_id")
                  ? externalIds.imdb_id
                  : false,
                tmdb_id: externalIds.hasOwnProperty("tmdb_id")
                  ? externalIds.tmdb_id
                  : false,
              },
            },
            { useFindAndModify: false }
          );
        } else {
          logger.log(
            "warn",
            `LIB CRON: Movie couldn't be matched - ${movieObj.title} - try rematching in Plex`
          );
        }
      } catch (err) {
        movieDb = false;
        logger.log({ level: "error", message: err });
      }
    }
  }

  async saveMusic(musicObj) {
    let musicDb = false;
    try {
      musicDb = await Music.findOne({
        ratingKey: parseInt(musicObj.ratingKey),
      });
      if (!this.full && musicDb) {
        return;
      }
    } catch {
      musicDb = false;
    }
    if (!musicDb) {
      try {
        let newMusic = new Music({
          title: musicObj.title,
          ratingKey: musicObj.ratingKey,
          key: musicObj.key,
          guid: musicObj.guid,
          type: musicObj.type,
          summary: musicObj.summary,
          index: musicObj.index,
          thumb: musicObj.thumb,
          addedAt: musicObj.addedAt,
          updatedAt: musicObj.updatedAt,
          Genre: musicObj.Genre,
          Country: musicObj.Country,
        });
        musicDb = await newMusic.save();
      } catch (err) {
        logger.log("error", `LIB CRON: Error`);
        logger.log({ level: "error", message: err });
      }
    }
  }

  async saveShow(showObj) {
    let showDb = false;

    try {
      showDb = await Show.findOne({ ratingKey: parseInt(showObj.ratingKey) });
    } catch {
      showDb = false;
    }

    let idSource = showObj.guid
      .replace("com.plexapp.agents.", "")
      .split("://")[0];
    let externalIds = {};
    let tmdbId = false;
    let externalId = false;
    if (idSource === "local") return;
    if (idSource === "plex") {
      let title = showObj.title;
      try {
        showObj = await this.getMeta(showObj.ratingKey);
        for (let guid of showObj.Guid) {
          let source = guid.id.split("://");
          externalIds[source[0] + "_id"] = source[1];
          if (source[0] === "tmdb") tmdbId = source[1];
        }
      } catch (err) {
        logger.log("warn", `LIB CRON: Unable to fetch meta for ${title}`);
        return;
      }
    } else {
      if (idSource === "thetvdb") {
        idSource = "tvdb";
      }
      if (idSource === "themoviedb") {
        idSource = "tmdb";
      }
      externalId = showObj.guid
        .replace("com.plexapp.agents.", "")
        .split("://")[1]
        .split("?")[0];

      if (idSource !== "tmdb") {
        try {
          tmdbId = await this.externalIdTv(externalId, idSource);
        } catch {
          tmdbId = false;
        }
      } else {
        try {
          externalIds = await this.tmdbExternalIds(externalId);
        } catch (err) {
          logger.log({ level: "warn", message: err });
        }
      }
    }

    if (!showDb) {
      try {
        let newShow = new Show({
          ratingKey: showObj.ratingKey,
          key: showObj.key,
          guid: showObj.guid,
          studio: showObj.studio,
          type: showObj.type,
          title: showObj.title,
          titleSort: showObj.titleSort,
          contentRating: showObj.contentRating,
          summary: showObj.summary,
          index: showObj.index,
          rating: showObj.rating,
          year: showObj.year,
          thumb: showObj.thumb,
          art: showObj.art,
          banner: showObj.banner,
          theme: showObj.theme,
          duration: showObj.duration,
          originallyAvailableAt: showObj.originallyAvailableAt,
          leafCount: showObj.leafCount,
          viewedLeafCount: showObj.viewedLeafCount,
          childCount: showObj.childCount,
          addedAt: showObj.addedAt,
          updatedAt: showObj.updatedAt,
          Genre: showObj.Genre,
          idSource: idSource,
          externalId: externalId,
          imdb_id: idSource === "imdb" ? externalId : externalIds.imdb_id,
          tvdb_id: idSource === "tvdb" ? externalId : externalIds.tvdb_id,
          tmdb_id: idSource === "tmdb" ? externalId : tmdbId,
        });
        if (idSource !== "tmdb" && !tmdbId) {
          logger.log(
            "warn",
            `LIB CRON: Show couldn't be matched - ${showObj.title} - try rematching in Plex`
          );
        } else {
          showDb = await newShow.save();
          await this.mailAdded(showObj, newShow.tmdb_id);
          logger.log("info", `LIB CRON: Show Added - ${showObj.title}`);
        }
      } catch (err) {
        logger.log("error", `LIB CRON: Error`);
        logger.log({ level: "error", message: err });
      }
    } else {
      try {
        if (idSource === "tmdb" || tmdbId) {
          await Show.findOneAndUpdate(
            {
              ratingKey: showObj.ratingKey,
            },
            {
              $set: {
                ratingKey: showObj.ratingKey,
                key: showObj.key,
                guid: showObj.guid,
                studio: showObj.studio,
                type: showObj.type,
                title: showObj.title,
                titleSort: showObj.titleSort,
                contentRating: showObj.contentRating,
                summary: showObj.summary,
                index: showObj.index,
                rating: showObj.rating,
                year: showObj.year,
                thumb: showObj.thumb,
                art: showObj.art,
                banner: showObj.banner,
                theme: showObj.theme,
                duration: showObj.duration,
                originallyAvailableAt: showObj.originallyAvailableAt,
                leafCount: showObj.leafCount,
                viewedLeafCount: showObj.viewedLeafCount,
                childCount: showObj.childCount,
                addedAt: showObj.addedAt,
                updatedAt: showObj.updatedAt,
                Genre: showObj.Genre,
                idSource: idSource,
                externalId: externalId,
                imdb_id: idSource === "imdb" ? externalId : externalIds.imdb_id,
                tvdb_id: idSource === "tvdb" ? externalId : externalIds.tvdb_id,
                tmdb_id: idSource === "tmdb" ? externalId : tmdbId,
              },
            },
            { useFindAndModify: false }
          );
        } else {
          logger.log(
            "warn",
            `LIB CRON: Show couldn't be matched - ${showObj.title} - try rematching in Plex`
          );
        }
      } catch {
        showDb = false;
      }
    }
  }

  async updateFriends() {
    logger.info("LIB CRON: Updating Friends");
    let friendList = false;
    try {
      friendList = await this.getFriends();
    } catch (err) {
      logger.log("error", `LIB CRON: Error getting friend list`);
      logger.log({ level: "error", message: err });
    }
    if (friendList) {
      await Promise.all(
        Object.keys(friendList).map(async (item) => {
          await this.saveFriend(friendList[item].attributes);
        })
      );
    }
  }

  async getFriends() {
    let url = `https://plex.tv/pms/friends/all?X-Plex-Token=${this.config.plexToken}`;
    try {
      let res = await axios.get(url);
      let dataParse = JSON.parse(
        xmlParser.xml2json(res.data, { compact: false })
      );
      return dataParse.elements[0].elements;
    } catch (e) {
      logger.log("error", "LIB CRON: Unable to get friends");
      logger.log("error", `LIB CRON: Error`);
      logger.log({ level: "error", message: e });
      throw "Unable to get friends";
    }
  }

  async saveFriend(obj) {
    // Maybe delete all and rebuild each time?
    let friendDb = false;
    try {
      friendDb = await User.findOne({ id: obj.id });
    } catch {
      friendDb = false;
    }

    if (!friendDb) {
      try {
        let defaultProfile = await Profile.findOne({ isDefault: true });
        let newFriend = new User({
          id: obj.id,
          title: obj.title,
          username: obj.username ? obj.username : obj.title,
          nameLower: obj.username
            ? obj.username.toLowerCase()
            : obj.title.toLowerCase(),
          email: obj.email.toLowerCase(),
          recommendationsPlaylistId: obj.recommendationsPlaylistId,
          thumb: obj.thumb,
          Server: obj.Server,
          quotaCount: 0,
        });
        if (defaultProfile) {
          newFriend.profile = defaultProfile._id;
        }
        friendDb = await newFriend.save();
      } catch (err) {
        logger.log("error", `LIB CRON: Error`);
        logger.log({ level: "error", message: err });
      }
      if (friendDb) {
        logger.log("info", `LIB CRON: User Created ${obj.title}`);
      } else {
        logger.log("warn", `LIB CRON: User Failed to Create ${obj.title}`);
      }
    }
  }

  async mailAdded(plexData, ref_id) {
    let request = await Request.findOne({ tmdb_id: ref_id });
    if (request) {
      await Promise.all(
        request.users.map(async (user, i) => {
          await this.sendMail(user, i, request);
        })
      );
      await new processRequest(request).archive(true, false);
    }
  }

  async sendMail(user, i, request) {
    let userData = await User.findOne({ id: user });
    if (!userData) {
      logger.log("error", "LIB CRON: Err: No user data");
      return;
    }
    this.discordNotify(userData, request);
    if (!userData.email) {
      logger.log("warn", "LIB CRON: Err: User has no email");
      return;
    }

    this.mailer.push([
      `${request.title} added to Plex!`,
      `${request.title} added to Plex!`,
      "Your request has now been processed and is ready to watch on Plex, thanks for your request!",
      `https://image.tmdb.org/t/p/w500${request.thumb}`,
      [userData.email],
      [userData.title],
    ]);

    logger.log("info", `LIB CRON: Mailer updated`);
  }

  discordNotify(user, request) {
    let type = request.type === "tv" ? "TV Show" : "Movie";
    new Discord().send(
      `${request.title} added to Plex!`,
      `The ${type} "${request.title}" has been processed and is now available to watch on Plex"`,
      user.title,
      `https://image.tmdb.org/t/p/w500${request.thumb}`
    );
  }

  execMail() {
    logger.log("info", "MAILER: Parsing mail queue");
    this.mailer.forEach((mail, index) => {
      setTimeout(() => {
        new Mailer().mail(mail[0], mail[1], mail[2], mail[3], mail[4], mail[5]);
      }, 10000 * (index + 1));
    });
    this.mailer = [];
  }

  async externalIdTv(id, type) {
    let url = `${this.tmdb}find/${id}?api_key=${this.config.tmdbApi}&language=en-US&external_source=${type}_id`;
    try {
      let res = await axios.get(url);
      return res.data.tv_results[0].id;
    } catch (e) {
      throw e;
    }
  }

  async tmdbExternalIds(id) {
    let url = `${this.tmdb}tv/${id}/external_ids?api_key=${this.config.tmdbApi}`;
    try {
      let res = await axios.get(url);
      return res.data;
    } catch (e) {
      throw e;
    }
  }

  async externalIdMovie(id) {
    let url = `${this.tmdb}movie/${id}/external_ids?api_key=${this.config.tmdbApi}`;
    try {
      let res = await axios.get(url);
      return res.data;
    } catch (e) {
      throw e;
    }
  }

  async checkOldRequests() {
    logger.info("LIB CRON: Checking old requests");
    let requests = await Request.find();
    for (let i = 0; i < requests.length; i++) {
      let onServer = false;
      let request = requests[i];
      if (request.type === "tv") {
        onServer = await Show.findOne({ tmdb_id: request.tmdb_id });
        if (!request.tvdb_id) {
          logger.info(
            `LIB CRON: No TVDB ID for request: ${request.title}, attempting to pull meta`
          );
          let lookup = await showLookup(request.tmdb_id, true);
          request.thumb = lookup.poster_path;
          request.tvdb_id = lookup.tvdb_id;
          try {
            await request.save();
            logger.info(
              `LIB CRON: Meta updated for request: ${request.title}, processing request with updated meta`
            );
            if (request.tvdb_id)
              new processRequest({
                id: request.requestId,
                type: request.type,
                title: request.title,
                thumb: request.thumb,
                imdb_id: request.imdb_id,
                tmdb_id: request.tmdb_id,
                tvdb_id: request.tvdb_id,
                approved: request.approved,
              }).sendToDvr(false);
          } catch (err) {
            logger.info(
              `LIB CRON: Failed to update meta for request: ${request.title}`
            );
          }
        }
      }
      if (request.type === "movie") {
        onServer = await Movie.findOne({ tmdb_id: request.tmdb_id });
      }

      if (onServer) {
        logger.verbose(`LIB CRON: Found missed request - ${request.title}`);
        new processRequest(request, false).archive(true, false, false);
        let emails = [];
        let titles = [];
        await Promise.all(
          request.users.map(async (user) => {
            let userData = await User.findOne({ id: user });
            if (!userData) return;
            emails.push(userData.email);
            titles.push(userData.title);
          })
        );
        new Mailer().mail(
          `${request.title} added to Plex!`,
          `${request.title} added to Plex!`,
          "Your request has now been processed and is ready to watch on Plex, thanks for your request!",
          `https://image.tmdb.org/t/p/w500${request.thumb}`,
          emails,
          titles
        );
      }
    }
  }
}

module.exports = LibraryUpdate;
