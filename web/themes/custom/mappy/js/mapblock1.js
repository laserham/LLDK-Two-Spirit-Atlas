(function ($, DS) {
    url = window.location.protocol + '//' + window.location.host + DS.path.baseUrl;
    window.mapblock.initMap(
        url + 'story_episode_book_chapter_geojson_feed',
        url + 'record_geojson_feed', true);
})(jQuery, window.drupalSettings);
