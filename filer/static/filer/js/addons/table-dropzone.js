// #DROPZONE#
// This script implements the dropzone settings
'use strict';

// as of Django 2.x we need to check where jQuery is
var djQuery = window.$;

if (django.jQuery) {
    djQuery = django.jQuery;
}

/* globals Dropzone, Cl, django */
(function ($) {
    $(function () {
        var submitNum = 0;
        var maxSubmitNum = 0;
        var dropzoneInstances = [];
        var dropzoneBase = $('.js-filer-dropzone-base');
        var dropzoneSelector = '.js-filer-dropzone';
        var dropzones;
        var infoMessageClass = 'js-filer-dropzone-info-message';
        var infoMessage = $('.' + infoMessageClass);
        var folderName = $('.js-filer-dropzone-folder-name');
        var uploadInfoContainer = $('.js-filer-dropzone-upload-info-container');
        var uploadInfo = $('.js-filer-dropzone-upload-info');
        var uploadWelcome = $('.js-filer-dropzone-upload-welcome');
        var uploadNumber = $('.js-filer-dropzone-upload-number');
        var uploadCount = $('.js-filer-upload-count');
        var uploadText = $('.js-filer-upload-text');
        var uploadFileNameSelector = '.js-filer-dropzone-file-name';
        var uploadProgressSelector = '.js-filer-dropzone-progress';
        var uploadSuccess = $('.js-filer-dropzone-upload-success');
        var uploadCanceled = $('.js-filer-dropzone-upload-canceled');
        var cancelUpload = $('.js-filer-dropzone-cancel');
        var dragHoverClass = 'dz-drag-hover';
        var dataUploaderConnections = 'max-uploader-connections';
        var dragHoverBorder = $('.drag-hover-border');
        // var dataMaxFileSize = 'max-file-size';
        var hiddenClass = 'hidden';
        var hideMessageTimeout;
        var hasErrors = false;
        var baseUrl;
        var baseFolderTitle;
        var updateUploadNumber = function updateUploadNumber() {
            uploadNumber.text(maxSubmitNum - submitNum + '/' + maxSubmitNum);
            uploadText.removeClass('hidden');
            uploadCount.removeClass('hidden');
        };
        var destroyDropzones = function destroyDropzones() {
            $.each(dropzoneInstances, function (index) {
                dropzoneInstances[index].destroy();
            });
        };
        var getElementByFile = function getElementByFile(file, url) {
            return $(document.getElementById('file-' +
                encodeURIComponent(file.name) +
                file.size +
                file.lastModified +
                url
            ));
        };

        var token = $('input[name="csrfmiddlewaretoken"]').attr('value');

function CustomConfirm(){
	this.render = function(dialog, table_content){
		var winW = window.innerWidth;
	    var winH = window.innerHeight;
		var dialogoverlay = document.getElementById('dialogoverlay');
	    var dialogbox = document.getElementById('dialogbox');
		dialogoverlay.style.display = "block";
	    dialogoverlay.style.height = winH+"px";
		dialogbox.style.left = (winW/2) - (550 * .5)+"px";
	    dialogbox.style.top = "100px";
	    dialogbox.style.display = "block";

		document.getElementById('dialogboxhead').innerHTML = "Confirm that action";
	    document.getElementById('dialogboxbody').innerHTML = dialog;
	    document.getElementById('dialogboxbodytable').innerHTML = table_content
		document.getElementById('dialogboxfoot').innerHTML = '<button onclick="Confirm.yes()">Yes</button> <button onclick="close()">No</button>';
	}
	this.no = function(){
		document.getElementById('dialogbox').style.display = "none";
		document.getElementById('dialogoverlay').style.display = "none";
	}
	this.yes = function(){
		document.getElementById('dialogbox').style.display = "none";
		document.getElementById('dialogoverlay').style.display = "none";
	}
}
var Confirm = new CustomConfirm();

        if (dropzoneBase && dropzoneBase.length) {
            baseUrl = dropzoneBase.data('url');
            baseFolderTitle = dropzoneBase.data('folder-name');

            $('body').data('url', baseUrl).data('folder-name', baseFolderTitle).addClass('js-filer-dropzone');
        }

        Cl.mediator.subscribe('filer-upload-in-progress', destroyDropzones);

        dropzones = $(dropzoneSelector);

        if (dropzones.length && Dropzone) {

            Dropzone.autoDiscover = false;
            dropzones.each(function () {
                var dropzone = $(this);
                var dropzoneUrl = $(this).data('url');
                var dataAccept = $(this).data("accept");
                if (dataAccept !== undefined) {
                    dropzoneUrl = dataAccept
                }
                var dropzoneInstance = new Dropzone(this, {
                    url: dropzoneUrl,
                    paramName: 'file',
                    maxFiles: 100,
                    // for now disabled as we don't have the correct file size limit
                    // maxFilesize: dropzone.data(dataMaxFileSize) || 20, // MB
                    previewTemplate: '<div></div>',
                    clickable: false,
                    addRemoveLinks: false,
                    parallelUploads: dropzone.data(dataUploaderConnections) || 1,
                    // autoProcessQueue: false,
                    uploadMultiple: true,

                    // init: function() {
                    //     this.on("addedfile", function(file) { alert("Added file."); });
                    // },

                    // ensure that the path information is sent as part of the request,
                    // without this the path is stripped out automatically by Django.

                    init: function() {
                        this.on("sendingmultiple", function() {
                            // Lets check if the file already exists or for any restrictions
                            var url = dropzoneUrl
                            console.log(url)
                            var filenames = [];

                            this.files.forEach(function (file) {
                                filenames.push(file.name)
                                filenames.push((file.size  / (1024*1024)).toFixed(2))
                                filenames.push(new Date(file.lastModified).toDateString() + '\n')
                            });

                            var request = $.ajax({
                                url: url,
                                type: "POST",
                                // dataType: 'JSON',
                                data: {'test[]': filenames,
                                    'csrfmiddlewaretoken': token
                                    },
                            });
                            request.done(function (response, textStatus, jqXHR) {
                                var message = 'The listed files already exist, are you sure you want to continue?\n\n'
                                var table =  "<table><tr><th>Filename</th><th>File Size</th><th>Date Modified</th></tr>"
                                $.each(response.success, function (i,v) {
                                      table += "<tr><td>"+ v[0] +"</td><td>"+ v[1] +"</td><td>"+ v[2] +"</td></tr>"
                                })
                                table += "</table>"
                                // Confirm.render(message, table)
                                // window.stop();
                                var check_answer = confirm(message + response['success']);
                                // if (showModal == true) {
                                //
                                //     return false;
                                // }
                                // var check_answer = confirm(message + response['success']);
                                // else{
                                //     //pass and do nothing;
                                // }
                                //

                                // if (test == true) {
                                //     console.log('User agreed')
                                //     return true;
                                // }
                                //
                                //
                                // else {
                                //     console.log('User declined')
                                //     return false;
                                // }




                            });
                            request.fail(function (jqXHR, textStatus, errorThrown){
                                console.error(
                                    "The following error occurred: "+
                                    textStatus, errorThrown
                                );
                            });
                        });
                    },

                    params: function params(files, xhr, chunk) {
                        var metadata = {};
                        var fullPath;
                        files.forEach(function (file) {
                            metadata = {
                                uuid: file.upload.uuid,
                                size: file.upload.total,
                                chunked: file.upload.chunked
                            };
                            fullPath = file.fullPath;
                            if (fullPath) {
                                // remove the filename from the path, as this is already transmitted separately
                                metadata.path = fullPath.substr(0, fullPath.lastIndexOf('/'));
                            }
                        });
                        if (chunk) {
                            metadata.dzuuid = chunk.file.upload.uuid;
                            metadata.dzchunkindex = chunk.index;
                            metadata.dztotalfilesize = chunk.file.size;
                            metadata.dzchunksize = this.options.chunkSize;
                            metadata.dztotalchunkcount = chunk.file.upload.totalChunkCount;
                            metadata.dzchunkbyteoffset = chunk.index * this.options.chunkSize;
                        }

                        return metadata;
                    },

                    accept: function accept(file, done) {
                        console.log('TESTING ACCEPT FUNCTION')


                        var uploadInfoClone;

                        Cl.mediator.remove('filer-upload-in-progress', destroyDropzones);
                        Cl.mediator.publish('filer-upload-in-progress');

                        clearTimeout(hideMessageTimeout);
                        uploadWelcome.addClass(hiddenClass);
                        cancelUpload.removeClass(hiddenClass);

                        if (getElementByFile(file, dropzoneUrl).length) {
                            done('duplicate');
                        } else {
                            uploadInfoClone = uploadInfo.clone();

                            uploadInfoClone.find(uploadFileNameSelector).text(file.name);
                            uploadInfoClone.find(uploadProgressSelector).width(0);
                            uploadInfoClone.attr('id', 'file-' +
                                encodeURIComponent(file.name) +
                                file.size + file.lastModified +
                                dropzoneUrl
                            ).appendTo(uploadInfoContainer);

                            submitNum++;
                            maxSubmitNum++;
                            updateUploadNumber();
                            done();
                        }

                        dropzones.removeClass('reset-hover');
                        infoMessage.removeClass(hiddenClass);
                        dropzones.removeClass(dragHoverClass);

                    },
                    dragover: function dragover(dragEvent) {
                        var folderTitle = $(dragEvent.target).closest(dropzoneSelector).data('folder-name');
                        var dropzoneFolder = dropzone.hasClass('js-filer-dropzone-folder');
                        var dropzoneBoundingRect = dropzone[0].getBoundingClientRect();
                        var borderSize = $('.drag-hover-border').css('border-top-width');
                        var dropzonePosition = {
                            top: dropzoneBoundingRect.top,
                            bottom: dropzoneBoundingRect.bottom,
                            width: dropzoneBoundingRect.width,
                            height: dropzoneBoundingRect.height - parseInt(borderSize, 10) * 2
                        };
                        if (dropzoneFolder) {
                            dragHoverBorder.css(dropzonePosition);
                        }

                        $(dropzones).addClass('reset-hover');
                        uploadSuccess.addClass(hiddenClass);
                        infoMessage.removeClass(hiddenClass);
                        dropzone.addClass(dragHoverClass).removeClass('reset-hover');

                        folderName.text(folderTitle);
                    },
                    dragend: function dragend() {
                        clearTimeout(hideMessageTimeout);
                        hideMessageTimeout = setTimeout(function () {
                            infoMessage.addClass(hiddenClass);
                        }, 1000);

                        infoMessage.removeClass(hiddenClass);
                        dropzones.removeClass(dragHoverClass);
                        dragHoverBorder.css({ top: 0, bottom: 0, width: 0, height: 0 });
                    },
                    dragleave: function dragleave() {
                        clearTimeout(hideMessageTimeout);
                        hideMessageTimeout = setTimeout(function () {
                            infoMessage.addClass(hiddenClass);
                        }, 1000);

                        infoMessage.removeClass(hiddenClass);
                        dropzones.removeClass(dragHoverClass);
                        dragHoverBorder.css({ top: 0, bottom: 0, width: 0, height: 0 });
                    },
                    sending: function sending(file) {
                        getElementByFile(file, dropzoneUrl).removeClass(hiddenClass);
                    },
                    uploadprogress: function uploadprogress(file, progress) {
                        getElementByFile(file, dropzoneUrl).find(uploadProgressSelector).width(progress + '%');
                    },
                    success: function success(file) {
                        submitNum--;
                        updateUploadNumber();
                        getElementByFile(file, dropzoneUrl).remove();
                    },
                    queuecomplete: function queuecomplete() {
                        if (submitNum !== 0) {
                            return;
                        }

                        updateUploadNumber();

                        cancelUpload.addClass(hiddenClass);
                        uploadInfo.addClass(hiddenClass);

                        if (hasErrors) {
                            uploadNumber.addClass(hiddenClass);
                            setTimeout(function () {
                                window.location.reload();
                            }, 1000);
                        } else {
                            uploadSuccess.removeClass(hiddenClass);
                            window.location.reload();
                        }
                    },
                    error: function error(file, errorText) {
                        updateUploadNumber();
                        if (errorText === 'duplicate') {
                            return;
                        }
                        hasErrors = true;
                        if (window.filerShowError) {
                            window.filerShowError(file.name + ': ' + errorText);
                        }
                    }
                });



                dropzoneInstances.push(dropzoneInstance);
                cancelUpload.on('click', function (clickEvent) {
                    clickEvent.preventDefault();
                    cancelUpload.addClass(hiddenClass);
                    uploadCanceled.removeClass(hiddenClass);
                    dropzoneInstance.removeAllFiles(true);
                });
            });
        }
    });
})(djQuery);
