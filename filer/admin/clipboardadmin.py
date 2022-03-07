# -*- coding: utf-8 -*-
from __future__ import absolute_import
import json

from django.conf.urls import url
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.forms.models import modelform_factory
from django.http import JsonResponse
from django.utils.module_loading import import_string
from django.views.decorators.csrf import csrf_exempt

from django.template.response import TemplateResponse

from django.db.models.functions import Coalesce
from django.db.models import Value


from .. import settings as filer_settings
from ..models import Clipboard, ClipboardItem, Folder, File

from djangocms_versioning_filer.models import get_files_distinct_grouper_queryset, NullIfEmptyStr

from ..utils.files import (
    UploadException, handle_request_files_upload, handle_upload,
)
from ..utils.loader import load_model
from . import views


NO_FOLDER_ERROR = "Can't find folder to upload. Please refresh and try again"
NO_PERMISSIONS_FOR_FOLDER = (
    "Can't use this folder, Permission Denied. Please select another folder."
)


Image = load_model(filer_settings.FILER_IMAGE_MODEL)


# ModelAdmins
class ClipboardItemInline(admin.TabularInline):
    model = ClipboardItem


class ClipboardAdmin(admin.ModelAdmin):
    model = Clipboard
    inlines = [ClipboardItemInline]
    filter_horizontal = ('files',)
    raw_id_fields = ('user',)
    verbose_name = "DEBUG Clipboard"
    verbose_name_plural = "DEBUG Clipboards"

    # class Media:
    #     js = ("filer/js/upload.js",)
    #     css = {
    #         "all": ("filer/css/upload.css",)
    #     }

    def get_urls(self):
        print('FILER -> CLIPBOARDADMIN -> GET URLS')
        return [
            url(r'^operations/paste_clipboard_to_folder/$',
                self.admin_site.admin_view(views.paste_clipboard_to_folder),
                name='filer-paste_clipboard_to_folder'),
            url(r'^operations/discard_clipboard/$',
                self.admin_site.admin_view(views.discard_clipboard),
                name='filer-discard_clipboard'),
            url(r'^operations/delete_clipboard/$',
                self.admin_site.admin_view(views.delete_clipboard),
                name='filer-delete_clipboard'),
            url(r'^operations/upload/(?P<folder_id>[0-9]+)/$',
                ajax_upload,
                name='filer-ajax_upload'),
            url(r'^operations/upload/no_folder/$',
                ajax_upload,
                name='filer-ajax_upload'),
            url(r'^operations/upload/check/(?P<folder_id>[0-9]+)/$',
                file_constraints_check,
                name='filer-check_file_constraints'),
            url(r'^operations/upload/check/no_folder/$',
                file_constraints_check,
                name='filer-check_file_constraints'),
            url(r'^operations/upload/validate_files/(?P<folder_id>[0-9]+)/$',
                validate_files,
                name='filer-validate_files'),
        ] + super(ClipboardAdmin, self).get_urls()

    def get_model_perms(self, *args, **kwargs):
        """
        It seems this is only used for the list view. NICE :-)
        """
        return {
            'add': False,
            'change': False,
            'delete': False,
        }

@csrf_exempt
def file_constraints_check(request, folder_id=None):
    """
    Call all file constraints define in settings and return json response
    """
    print('FILER -> CLIPBOARDADMIN -> FILE_CONSTRAINTS_CHECK')
    file_constraint_checks = filer_settings.FILER_FILE_CONSTRAINTS
    for path in file_constraint_checks:
        func = import_string(path)
        try:
            func(request, folder_id)
        except ValidationError as e:
            print(e)
            return JsonResponse({
                'success': False,
                'error': str(e)
            })
    return JsonResponse({'success': True})

@csrf_exempt
def ajax_upload(request, folder_id=None):
    """
    Receives an upload from the uploader. Receives only one file at a time.
    """
    if folder_id:
        try:
            # Get folder
            folder = Folder.objects.get(pk=folder_id)
        except Folder.DoesNotExist:
            return JsonResponse({'error': NO_FOLDER_ERROR})
    else:
        folder = Folder.objects.filter(pk=request.session.get('filer_last_folder_id', 0)).first()

    # check permissions
    if folder and not folder.has_add_children_permission(request):
        return JsonResponse({'error': NO_PERMISSIONS_FOR_FOLDER})
    try:
        if len(request.FILES) == 1:
            # dont check if request is ajax or not, just grab the file
            upload, filename, is_raw = handle_request_files_upload(request)
        else:
            # else process the request as usual
            upload, filename, is_raw = handle_upload(request)


        # TODO: Deprecated/refactor
        # Get clipboad
        # clipboard = Clipboard.objects.get_or_create(user=request.user)[0]
        # find the file type
        for filer_class in filer_settings.FILER_FILE_MODELS:
            FileSubClass = load_model(filer_class)
            # TODO: What if there are more than one that qualify?
            if FileSubClass.matches_file_type(filename, upload, request):
                FileForm = modelform_factory(
                    model=FileSubClass,
                    fields=('original_filename', 'owner', 'file')
                )
                break
        uploadform = FileForm({'original_filename': filename,
                               'owner': request.user.pk},
                              {'file': upload})
        if uploadform.is_valid():
            file_obj = uploadform.save(commit=False)
            # Enforce the FILER_IS_PUBLIC_DEFAULT
            file_obj.is_public = filer_settings.FILER_IS_PUBLIC_DEFAULT
            file_obj.folder = folder
            file_obj.save()
            # TODO: Deprecated/refactor
            # clipboard_item = ClipboardItem(
            #     clipboard=clipboard, file=file_obj)
            # clipboard_item.save()

            # Try to generate thumbnails.
            if not file_obj.icons:
                # There is no point to continue, as we can't generate
                # thumbnails for this file. Usual reasons: bad format or
                # filename.
                file_obj.delete()
                # This would be logged in BaseImage._generate_thumbnails()
                # if FILER_ENABLE_LOGGING is on.
                return JsonResponse(
                    {'error': 'failed to generate icons for file'},
                    status=500,
                )
            thumbnail = None
            # Backwards compatibility: try to get specific icon size (32px)
            # first. Then try medium icon size (they are already sorted),
            # fallback to the first (smallest) configured icon.
            for size in (['32']
                        + filer_settings.FILER_ADMIN_ICON_SIZES[1::-1]):
                try:
                    thumbnail = file_obj.icons[size]
                    break
                except KeyError:
                    continue

            data = {
                'thumbnail': thumbnail,
                'alt_text': '',
                'label': str(file_obj),
                'file_id': file_obj.pk,
            }
            # prepare preview thumbnail
            if type(file_obj) == Image:
                thumbnail_180_options = {
                    'size': (180, 180),
                    'crop': True,
                    'upscale': True,
                }
                thumbnail_180 = file_obj.file.get_thumbnail(
                    thumbnail_180_options)
                data['thumbnail_180'] = thumbnail_180.url
                data['original_image'] = file_obj.url
            return JsonResponse(data)
        else:
            form_errors = '; '.join(['%s: %s' % (
                field,
                ', '.join(errors)) for field, errors in list(
                    uploadform.errors.items())
            ])
            raise UploadException(
                "AJAX request not valid: form invalid '%s'" % (
                    form_errors,))
    except UploadException as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
def validate_files(request, folder_id=None):
    # Check if the file is locked or already exists
    from filer.models import Folder, File
    from django.utils.translation import ugettext as _
    FILE_EXISTS = _('File name already exists')

    if request.is_ajax:
        list_of_files = request.POST.getlist('test[]')
        list_of_files = [list_of_files[offs:offs+3] for offs in range(0, len(list_of_files), 3)]

        try:
            # Get folder
            folder = Folder.objects.get(pk=folder_id)
        except Folder.DoesNotExist:
            # if folder not exists then not proceeding further check and return
            return

        # if folder:
        #     print(folder)
        #     print('Should print request.FILES -> Start')
        #     print(request.FILES)
        #     print('Should print request.FILES -> End')
        #     if len(request.FILES) == 1:
        #         # dont check if request is ajax or not, just grab the file
        #         upload = list(request.FILES.values())[0]
        #         filename = upload.name
        #     else:
        #         # else process the request as usual
        #         filename = request.GET.get('qqfile', False) or request.GET.get('filename', False) or ''
        #     if File.objects.filter(
        #         original_filename=filename,
        #         folder_id=folder_id
        #     ):
        #         raise ValidationError(FILE_EXISTS)
        # return


        # # Test
        # path = request.POST.get('path')
        # path_split = path.split('/') if path else []
        #
        # # check permissions and data
        #
        # folder = Folder.objects.get(pk=folder_id)
        # # print(list(request.FILES.values()))
        # # upload, filename, is_raw = handle_request_files_upload(request)
        # filename = '1.jpeg'
        # upload = '1.jpeg'
        # for filer_class in filer_settings.FILER_FILE_MODELS:
        #     FileSubClass = load_model(filer_class)
        #     # TODO: What if there are more than one that qualify?
        #     if FileSubClass.matches_file_type(filename, upload, request):
        #         FileForm = modelform_factory(
        #             model=FileSubClass,
        #             fields=('original_filename', 'owner', 'file')
        #         )
        #         break
        # uploadform = FileForm({'original_filename': list_of_files[0],
        #                        'owner': request.user.pk},
        #                       {'file': upload})
        #
        # # print(uploadform)
        # if uploadform.is_valid():
        #     print('FORM IS VALID')
        #     file_obj = uploadform.save(commit=False)
        #     # Enforce the FILER_IS_PUBLIC_DEFAULT
        #     file_obj.is_public = filer_settings.FILER_IS_PUBLIC_DEFAULT
        #
        #     # Set the file's folder
        #     current_folder = folder
        #     for segment in path_split:
        #         try:
        #             current_folder = Folder.objects.get(
        #                 name=segment, parent=current_folder)
        #         except Folder.DoesNotExist:
        #             # If the current_folder can't have subfolders then
        #             # return a permission error
        #             if current_folder and not current_folder.can_have_subfolders:
        #                 error_msg = filer.admin.clipboardadmin.NO_PERMISSIONS_FOR_FOLDER
        #                 return JsonResponse({'error': error_msg})
        #             current_folder = Folder.objects.create(
        #                 name=segment, parent=current_folder)
        #         else:
        #             # If the folder already exists, check the user is
        #             # allowed to upload here
        #             if not current_folder.has_add_children_permission(request):
        #                 error_msg = filer.admin.clipboardadmin.NO_PERMISSIONS_FOR_FOLDER
        #                 return JsonResponse({'error': error_msg})
        #     file_obj.folder = current_folder
        #
        #     same_name_file_qs = get_files_distinct_grouper_queryset().annotate(
        #         _name=NullIfEmptyStr('name'),
        #         _original_filename=NullIfEmptyStr('original_filename'),
        #     ).annotate(
        #         # seperate annotate is needed to get it work on python<36
        #         # see PEP 468 for more details
        #         _label=Coalesce('_name', '_original_filename', Value('unnamed file')),
        #     ).filter(folder=folder, _label=file_obj.label)
        #     existing_file_obj = same_name_file_qs.first()
        #
        #     if existing_file_obj:
        #         file_grouper = existing_file_obj.grouper
        #         new_file_grouper = False
        #
        #         existing_file_version = Version.objects.get_for_content(existing_file_obj)
        #         if existing_file_version.state == DRAFT and not all([
        #             existing_file_version.can_be_archived(),
        #             existing_file_version.check_archive.as_bool(request.user),
        #         ]):
        #             return JsonResponse({'error': (
        #                 'Cannot archive existing {} file version'.format(existing_file_obj)
        #             )})

        return JsonResponse({'success': list_of_files})
