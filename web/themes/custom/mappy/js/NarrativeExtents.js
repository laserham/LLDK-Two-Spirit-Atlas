(function ($, L) {
    (function(b){
        function c(){}for(var d=["error","info","log","warn"],a;a=d.pop();)b[a]=b[a]||c
    })(window.console=window.console||{});

    /*
     * Narrative extents (NE) are a collection of geographic extents
     * (frames) to be used to frame elements of interest for part of
     * a geographic narrative. However defined, a NE is intended to
     * frame a map around one or more narrative elements within a 
     * story. As a set, NE can be used to (re)frame all parts of a
     * geographic narrative. 
     *
     * In this implementation, a NE is one of the following or a
     * combination of the two:
     *
     * - grouped narrative extent: the minimum bounding box (MBB)
     *   that encloses a set of geograhpically located narrative
     *   elements, treated as a group. The grouping of narrative
     *   elements is an editorial decision.
     *
     * - defined extent: a hard-coded geographic extent, defined as
     *   a geojson object from which a bounding box will be derived.
     * 
     * Intended use: NARRATIVE ELEMENTS REFERENCE 0 OR 1 NARRATIVE
     *               EXTENTS.
     * To progress through a geo-located narrative as a sequence of
     * events, each narrative item ("episode", "story setting",
     * "chapter", diary entry", etc.), represented as one or more
     * geographic features optionally can be linked to a NE. Using
     * some UI design to progress through the narrative as a sequence
     * (time line, chapter list, episode list, sequence), the
     * (re-)initialization of the map to show the "next" narrative
     * element(s) should simultaneously a) filter narrative elements
     * to be shown and b) frame the map according to the NE (or lack
     * thereof) configured for that (set of) narrative elements. If
     * the (set of) narrative elements is not linked to a NE, the
     * minimum bounding box of the elements themselves should be
     * used to frame the map.
     *
     * Intended use: NARRATIVE EXTENTS MIGHT REFERENCE MULTIPLE
     *               NARRATIVE ELEMENTS TO DEFINE A MBB
     * The implementation of the narrative elements, beyond the
     * scope of this software will be responsible for identifying
     * a NE that is to be used when framing the map for a particular
     * narrative element. The NE is capable of referencing a set of
     * narrative elements, stored here as an array of identifiers
     * that are used in aggregate to calculate the bounding box for
     * the NE.
     *
     * Intended use: NARRATIVE EXTENTS MIGHT CONTAIN A HARDCODED
     *               EXTENT
     * A NE first tries to calculate a pre-defined MBB from a
     * stored geojson. If found, this is the initial MBB for the
     * NE that might then be extended through reference to
     * narrative elements, as described above. A NE can then have
     * its geographic extent defined by a hard-coded feature extent,
     * the MBB of 1 or more narative elements, or a combination of
     * the two.
     *
     * Dependencies:
     * - Leaflet functions are used to define and extend bonuding
     *   boxes from geojson objects.
     * - This implmentation does not adjust map centre or zoom but
     *   only calculates the minimum bounding extent to be shown
     *   for a NE. Calling software is responsible for adjusting
     *   the map view. If there is no defined NE for a (set of)
     *   narrative element(s), the calling software will adjust
     *   the map view, probably according to the minimum bounding
     *   box of the narrative elements.
     * 
     * This file implements named SETS of narrative items but only one
     * set of NE. Different types of narrative items
     * can be framed using a single set of NE, with each of those types
     * possibly being loaded as a separate NIS, and all NIS contributing
     * to the same aggregated NE.
     */

    let _narrativeItemSet = function() {
        /*
         * This is a set of items that each has an associated
         * geographic extent. These are aggregated into some
         * larger MBB based on being identified as part of one
         * or more NE.
         */

        let _options = null;

        /*
         * Dictionary of extents keyed off NE identifiers.
         */
        let _extents = {};

        /*
         * initialize the extents for all known narrative items in this
         * set.
         *
         * options: json object
         * data: geojson containing narrative items (features) that
         *       optional define part of an aggregate MBB for identified
         *       narrative extents.
         *       - if the getIdFn for each feature returns a valid
         *         NE ID (i.e., the referenced narrative item links back
         *         to an NE), then create or extend the NE.
         *       - if the getIdFn returns invalid ID, the feature
         *         is not part of an aggregate NE
         */
        init = function(options, data) {
            let _defaultOptions = {
                /* function to return NE identifier for feature. */
                getIdFn: function(obj) { return null; }
            };

            _options = $.extend({}, _defaultOptions, options);
            data.features.forEach(function(obj) {
                let id = _options.getIdFn(obj);
                if (id !== null) {
                    /*
                     * this object contributes to a NE
                     */
                    b = L.geoJson(obj).getBounds();
                    if (!_extents.hasOwnProperty(id)) {
                        /* first time this NE id seen */
                        _extents[id] = b
                    } else {
                        /* 
                         * extend the geographic area of an existing 
                         * NE
                         */
                        _extents[id].extend(b);
                    };
                };
            });
            // console.log(Object.keys(_extents));
        };

        getExtent = function(id) {
            // if (typeof _extents[id] == 'undefined') {
            //     console.log("_extents[id] undefined: " + id)
            // };
            return(_extents[id]);
        };

        return {
            init: init,
            getExtent: getExtent
        };
    };

    let NarrativeExtents = function () {
        const _extentsAttr = 'extents';
        let wkt = new Wkt.Wkt();
        
        /*
         * A set of identified geographic extents and functions to
         * initialize and return them.
         */
        let _options = null;

        /*
         * Ensure that the extents are defined before beginning to use.
         */
        let _definedFlag = false;
        _defined = function() {
            return _definedFlag;
        };

        let _setDefined = function(f) {
            _definedFlag = f;
        };

        /*
         * There can be multiple narrative item (feature) (NIS) sets that
         * contribute to the initialization of the NE. This implementation
         * simply tracks whether the NE have been defined based on all
         * expected NIS before extents are used.
         */
        let _narrativeItemSets = {};

        /*
         * Narrative extents. This dictionary contains named NE, each of
         * which stores the narrative item set as an identifier array (nis)
         * and, once initialized, the calculated NE (extent).
         */
        let _ne = {};
        let _episode_to_ne_table = {};

        let setOrExpandExtent = function(id, extent) {
            /*
             * if a valid extent, set or extend the NE.
             * First time - copy bounds extent. After,
             * extend the extent already stored.
             */
            if (!_ne[id].hasOwnProperty(_extentsAttr)) {
                _ne[id][_extentsAttr] = extent.pad(0); /* make a copy */
            } else {
                _ne[id][_extentsAttr].extend(extent);
            };
        };

        let _calculateAllExtents = function() {
            /*
             * Once the NIS are all loaded, calculate the aggregated NE.
             */
            if (!_defined() ||
                _options.expectedNarrativeItemSetNames.length > 0) {
                return;
            };

            /*
             * Compute the extents. Note the above check means this is
             * only done once.
             */
            for (let a in _ne) {
                for (let n in _narrativeItemSets) {
                    _ne[a]['nis'].forEach(function(id) {
                        if (_ne[a].wktExtent != null) {
                            wkt.read(_ne[a].wktExtent);
                            setOrExpandExtent(a, L.geoJson(wkt.toJson()).getBounds());
                        };

                        /*
                         * error checking - some narrative item sets seem
                         * to link to locations that are undefined in some
                         * data layers (reasonable actually). Ignore.
                         */
                        let xt = _narrativeItemSets[n].getExtent(id);
                        if (typeof xt != 'undefined') {
                            setOrExpandExtent(a, xt);
                        };
                    });
                };
            };
        };

        /*
         * We create the narrative item sets and, for each, list all
         * NE identifiers.
         * 
         * Separately, we will be given the narrative items that contan
         * the geographic extent information.
         *
         * There is one set of NE, the extents of which might be defined
         * by multiple narrative item sets.
         */
        let init = function(options) {
            let _defaultOptions = {
                /*
                 * url to fetch a geojson stream defining the NE
                 */
                url: '',

                /*
                 * function template to return the NE identifier
                 * when passed a NE object.
                 */
                getNEIdFn: function(obj) { return null; },

                /*
                 * function template to return an array of narrative
                 * item identifiers (the set) when passed a NE object.
                 */
                getNISFn: function(obj) { return null; },

                /*
                 * Frome the view data provided, extract the episode
                 * that uses the NE and store it in a reverse look up
                 * table.
                 */
                getEpisodeIdFn: function(obj) { return null; },

                /*
                 * DIV id in case we need to display an error message. 
                 * Otherwise, this object works in the background.
                 */
                divid: '',
                
                /*
                 * Array of names defining the narrative item sets we
                 * expect to see. Used to decide when we are properly
                 * initilized. This should be set when this function
                 * is created. We remove names from this as
                 * things get initialized and we decide everything is
                 * initialized when the length of this array is zero.
                 */
                expectedNarrativeItemSetNames: []
            };
            _options = $.extend({}, _defaultOptions, options);

            $.getJSON(_options.url, function(data) {
                /*
                 * Store the narrative extent mappings (NE -> NIS
                 * defining the aggregated extent for the NE).
                 * Then mark that this has been defined.
                 */
                data.forEach(function(obj) {
                    /*
                     * obj: JSON narrative extent consisting of an ID and
                     *      a list (stored here as an array) of narrative ID
                     */
                    _ne[_options.getNEIdFn(obj)] = {
                        nis: _options.getNISFn(obj),

                        /*
                         * wktExtent: extends a narrative item set or
                         * defines narrative extent on its own.
                         */
                        wktExtent: obj.wktExtent == '' ? null : obj.wktExtent
                    };
                    _episode_to_ne_table[_options.getEpisodeIdFn(obj)] =
                        _options.getNEIdFn(obj);
                });
                _setDefined(true);
                _calculateAllExtents();

            }).fail(function(jqXHR, textStatus, errorThrown) {
                if (jqXHR.status == 403) {
                    $('#' + _options.divid)
                        .empty()
                        .removeClass()
                        .text("Access denied to " + _options.url);
                    return;
                };
                $('#' + _options.divid)
                    .empty()
                    .removeClass()
                    .text("Unknown error while accessing: " + _options.url +
                          " error: " + status);
                return;
            });
        };

        let createNarrativeItemsSet = function(name, appGetIdFn, data) {
            if (name in _narrativeItemSets) {
            //    console.warn("Narrative Item Set already defined: " + name);
                return;
            };

            nis = _narrativeItemSet();
            nis.init({ getIdFn: appGetIdFn }, data);
            _narrativeItemSets[name] = nis;

            i = _options.expectedNarrativeItemSetNames.indexOf(name);
            if (i > -1) {
                _options.expectedNarrativeItemSetNames.splice(i, 1);
            };

            _calculateAllExtents();
        };
        
        let getExtentFromEpisodeId = function(id) {
            if (_defined() &&
                _options.expectedNarrativeItemSetNames.length == 0 &&
                typeof id != 'undefined' && id != "" &&
                _episode_to_ne_table.hasOwnProperty(id)) {
                return _ne[_episode_to_ne_table[id]][_extentsAttr].pad(0); /* copy? */
            };
            return null;
        };

        return{
            init: init,
            createNarrativeItemsSet: createNarrativeItemsSet,
            getExtentFromEpisodeId: getExtentFromEpisodeId
        };
    };

    window.NarrativeExtents = NarrativeExtents;
})(jQuery, L);
