// dependencies
var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm')
    .subClass({ imageMagick: true }); // Enable ImageMagick integration.
var util = require('util');

// constants
var MAX_WIDTH  = 124;
var MAX_HEIGHT = 128;

// get reference to S3 client
var s3 = new AWS.S3();

exports.handler = function(event, context) {
    // Read options from the event.
    console.log("Reading options from event:\n", util.inspect(event, {depth: 5}));
    var srcBucket = event.Records[0].s3.bucket.name;
    // Object key may have spaces or unicode non-ASCII characters.
    var srcKey    =
        decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    var dstKey    = "photos/resized-" + srcKey;

    var jsonFile = 'photos/result.json';
    var newJsonData = {};
    var existsJsonData = [];
    // Sanity check: validate that source and destination are different buckets.
    /*if (srcBucket == dstBucket) {
        console.error("Destination bucket must not match source bucket.");
        return;
    }*/

    // check if the image is not the generated thumb
    // this check is to prevent endless loop of the script
    // make it to run only on uploaded new images and not on the thumbs pictures
    console.log('Reading file ' + srcKey);
    if (srcKey.search('resized') === -1 && srcKey.indexOf('photos') > -1) {

        // Infer the image type.
        var typeMatch = srcKey.match(/\.([^.]*)$/);
        if (!typeMatch) {
            console.error('unable to infer image type for key ' + srcKey);
            context.done();
            return;
        }
        var imageType = typeMatch[1].toLowerCase();
        if (imageType != "jpg" && imageType != "png") {
            console.log('skipping non-image ' + srcKey);
            context.done();
            return;
        }

        // Download the image from S3, transform, and upload to a different S3 bucket.
        async.waterfall([
                function download(next) {
                    // Download the image from S3 into a buffer.
                    s3.getObject({
                            Bucket: srcBucket,
                            Key: srcKey
                        },
                        next);
                },
                function tranform(response, next) {
                    gm(response.Body).size(function (err, size) {
                        // Infer the scaling factor to avoid stretching the image unnaturally.
                        var scalingFactor = Math.min(
                            MAX_WIDTH / size.width,
                            MAX_HEIGHT / size.height
                        );
                        console.log('Resize image by ' + scalingFactor);
                        var width = scalingFactor * size.width;
                        var height = scalingFactor * size.height;

                        // Transform the image buffer in memory.
                        this.resize(width, height)
                            .toBuffer(imageType, function (err, buffer) {
                                if (err) {
                                    next(err);
                                } else {
                                    next(null, response.ContentType, buffer);
                                }
                            });
                    });
                },
                function upload(contentType, data, next) {
                    // Stream the transformed image to a different S3 bucket.
                    console.log('Uploading thumb file ' + dstKey);
                    s3.putObject({
                            Bucket: srcBucket,
                            Key: dstKey,
                            Body: data,
                            ContentType: contentType
                        },function(err,data) {
                            next(null,err,data);
                        }
                    );

                },
                function getJsonFile(err,data,next) {
                    console.log('Search for result.json');
                    // try to get json file
                    s3.getObject({
                            Bucket: srcBucket,
                            Key: jsonFile
                        },function(err,data) {
                            next(null,err,data);
                        }
                    );
                },
                function(err, data) {
                    console.log('test');
                    if (err) {
                        console.log('results.json NOT FOUND!, creating one');
                    }
                    else {
                        // if the json file exists
                        console.log('results.json FOUND!, appending new thumb image');
                        existsJsonData = JSON.parse(data.Body);
                        // print json contents
                        console.log('exists json data: ' + existsJsonData);

                    }
                    // append to the exists json file
                    existsJsonData.push({
                            image: srcKey,
                            thumb: dstKey
                        }
                    );
                    console.log('new json data: ' + existsJsonData);
                    existsJsonData = JSON.stringify(existsJsonData);
                    console.log('new parsed json data: ' + existsJsonData);
                    // save updated json file
                    s3.putObject({
                        Bucket: srcBucket,
                        Key: jsonFile,
                        Body: existsJsonData,
                        ContentType: 'application/json'
                    },function(err,data) {
                        if (err) console.log(err,err.stack);
                        else {
                            console.log('result.json created, done!');
                            context.done();
                        }
                    });
                }
            ], function (err) {
                if (err) {
                    console.error(
                        'Unable to resize ' + srcBucket + '/' + srcKey +
                        ' and upload to ' + srcBucket + '/' + dstKey +
                        ' due to an error: ' + err
                    );
                } else {
                    console.log(
                        'Successfully resized ' + srcBucket + '/' + srcKey +
                        ' and uploaded to ' + srcBucket + '/' + dstKey
                    );
                }

                context.done();
            }
        );
    }
    else {
        console.log('I\'m not resizing thumb images or photos that are not in /photos directory');
        context.done();
    }
};