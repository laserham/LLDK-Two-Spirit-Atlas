This folder may contain patches that need to be applied to make things
work properly. I normally would not want this but sometimes it takes a
while to get a required fix into a committed version of contrib
modules or other elements. If these are essential for a feature of the
site, I add a patch here and update this file to show which version of
the component the patch applies to. See below.

The intention here is that a production site run released modules,
using composer to 'install' those, and that these patches when
required are applied to the component after composer install. On a
production site, this allows a drupal module to be run with composer
install and a simple patch application.


views_geojson  8.x-1.0  3158153-views_geojson_add_bbox_support_for_polygon_polyline_geofields-2.patch
core views     9.5.10   1349080_core_views_join_node_access_check_in_join_condition_521.patch

Note that the patch file names contain the Drupal issue number. You
can check that if needed to see whether or not this patch file still
needs to be applied to the component version you are running (and what
it is supposed to do).

Apply the patch with:

cd to the module folder

patch -p<N> < <path to patch file>

<N> will depend on the construction of the patch file and how many
levels of the patch you need to remove to get the relative file paths
in the patch file to work for your current working directory. For most
drupal patches, if you are working in the appropriate directory (see
the file paths in the diff), the correct value is usually 1.

