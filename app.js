var fs = require('fs');
var http = require('http');
var xml2js = require('xml2js');
var monk = require('monk');
var moment = require('moment');
var cron = require('cron');

var QMON_CRON_SCHEDULE = process.env.QMON_CRON_SCHEDULE;
var QMON_CRON_TIMEZONE = process.env.QMON_CRON_TIMEZONE;
var QMON_USSCONTENT_WS_HOST = process.env.QMON_USSCONTENT_WS_HOST;
var QMON_USSCONTENT_WS_PATH = process.env.QMON_USSCONTENT_WS_PATH;
var QMON_USSCONTENT_WS_USERAGENT = process.env.QMON_USSCONTENT_WS_USERAGENT;
var QMON_DB_URL = process.env.QMON_DB_URL;
var QMON_DB_COLL_QUEUETIME = process.env.QMON_DB_COLL_QUEUETIME

if (!QMON_CRON_SCHEDULE && !QMON_CRON_TIMEZONE && !QMON_USSCONTENT_WS_HOST &&
  !QMON_USSCONTENT_WS_HOST && !QMON_USSCONTENT_WS_PATH && !QMON_DB_URL &&
  !QMON_DB_COLL_QUEUETIME) {
  throw Error("One or more environment variables missing. Please check your configuration.");
}

var db = monk(QMON_DB_URL);
var CronJob = cron.CronJob;

var job = new CronJob({
  cronTime: QMON_CRON_SCHEDULE,
  onTick: monitorQueue,
  start: false,
  timeZone: QMON_CRON_TIMEZONE
});
job.start();

function monitorQueue() {
  console.log(new Date() + ' job triggered');
  getUSSContent(function handleResponse(err, response) {
    if (err) {
      console.log(err);
      return;
    }

    saveXml(response);
    parseXml(response, saveData);
  });
}

function getUSSContent(cb) {
  return http.get({
    host: QMON_USSCONTENT_WS_HOST,
    path: QMON_USSCONTENT_WS_PATH,
    headers: {
      'User-Agent': QMON_USSCONTENT_WS_USERAGENT,
    }
  }, function(response) {
    var completedResponse = '';
    response.on('data', function(d) {
      completedResponse += d;
    });
    response.on('error', function(err) {
      cb(err);
    });
    response.on('end', function() {
      cb(null, completedResponse);
    });
  })
  .on('error', function(err) {
    cb(err);
  })
}

function saveXml(data) {
  fs.writeFile('qmon-' + moment().format('YYYYMMDDHHmmSSz') + '.xml', data, function logResponse(err) {
    if (err) {
      console.log('error writing xml: ' + err);
      return;
    }
    console.log('xml saved');
  })
}

function parseXml(xmlString, cb) {
  var results = [];
  xml2js.parseString(xmlString, {explicitArray: false}, function buildJsonData(err, result) {
    if (err) {
      cb(err);
      return;
    }
    
    if (!result || !result.ResponseOfUSS || 
      !result.ResponseOfUSS.Result || !result.ResponseOfUSS.Result.USSZoneList || 
      !result.ResponseOfUSS.Result.USSZoneList.USSZone) {
      cb(new Error('Invalid XML data'));
      return;
    }

    var zones = result.ResponseOfUSS.Result.USSZoneList.USSZone;
    if (!Array.isArray(zones)) zones = [zones];

    for (x in zones) {
      var contents = zones[x].Content.USSContent;
      if (!Array.isArray(contents)) {
        contents = [contents];
      }

      for (y in contents) {
        var ride = {};
        ride['date'] = new Date();
        ride['contentId'] = contents[y].USSContentID
        ride['name'] = contents[y].Name
        ride['queueTime'] = Math.floor(contents[y].QueueTime)
        ride['zoneId'] = contents[y].ZoneID
        ride['zoneName'] = contents[y].ZoneName
        console.log(JSON.stringify(ride));
        results.push(ride);
      }
    }
    cb(null, results);
  });
}

function saveData(err, data) {
  if (err) {
    console.log(err);
    return;
  }

  db.get(QMON_DB_COLL_QUEUETIME).insert(data, function logResponse(err, doc) {
    if (err) console.log('save error. ' + err);
    else console.log('save success.')
  })
}