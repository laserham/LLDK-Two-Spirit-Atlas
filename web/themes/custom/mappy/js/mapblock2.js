(function ($, DS) {
    /*
     * This is the map block for the user's account page. Only shows
     * the content "prepared by me" (pbm).
     */
    function isInteger(value) {
        return /^\d+$/.test(value);
    };

    let url = window.location.protocol + '//' + window.location.host + DS.path.baseUrl;
    let pathname = window.location.pathname;
    let uid = pathname.substring(pathname.lastIndexOf("/") + 1);

    if (isInteger(uid)) { 
        window.mapblock.initMap(
            url + 'story_episode_book_chapter_pbm_geojson_feed/' + uid,
            url + 'record_pbm_geojson_feed/' + uid, false);
    } else {
        $('#block-mapblock2').empty().removeClass();
    };
})(jQuery, window.drupalSettings);
