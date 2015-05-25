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
    var dstKey    = "resized-" + srcKey;

    var tumbsDirectory = 'thumbs/';
    var jsonFile = 'result.json';
    var newImageObj = {};
    // Sanity check: validate that source and destination are different buckets.
    /*if (srcBucket == dstBucket) {
        console.error("Destination bucket must not match source bucket.");
        return;
    }*/

    // check if the image is not the generated thumb
    // this check is to prevent endless loop of the script
    // make it to run only on uploaded new images and not on the thumbs pictures
    if (!srcKey.search('resized')) {

        // Infer the image type.
        var typeMatch = srcKey.match(/\.([^.]*)$/);
        if (!typeMatch) {
            console.error('unable to infer image type for key ' + srcKey);
            return;
        }
        var imageType = typeMatch[1];
        if (imageType != "jpg" && imageType != "png") {
            console.log('skipping non-image ' + srcKey);
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
                    s3.putObject({
                            Bucket: srcBucket,
                            Key: dstKey,
                            Body: data,
                            ContentType: contentType
                        },next);

                }
                /*function getJsonFile(next) {
                    // try to get json file
                    s3.getObject({
                            Bucket: srcBucket,
                            Key: jsonFile
                        },next);
                },
                function updateJsonFile(response, next) {
                    newImageObj[srcKey] = {
                        thumb:dstKey
                    };
                    // if the json file exists
                    if (response.Body) {
                        // append to the exists json file
                        response.Body.push(newImageObj);
                        // save updated json file
                        s3.putObject({
                            Bucket: srcBucket,
                            Key: response,
                            Body: jsonFile.Body,
                            ContentType: 'application/json'
                        },next);
                    }
                    else {
                        s3.putObject({
                            Bucket: srcBucket,
                            Key: 'result.json',
                            Body: newImageObj,
                            ContentType: 'application/json'
                        },next);
                    }
                }*/
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
};