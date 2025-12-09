(function ($, DS) {
    /*
     * Derived from Survivor Stories Mapping. Content types have been repurposed.
     * If you dig into the views used here, you will find machine names based
     * on the older view and content type names. Views have been renamed and
     * content types have been relaballed.
     *
     * Story Episode - Book chapter = school based memory content type
     * Story Episode - Transcript = Survivor  content type
     * Story Episode Setting = School  content type
     * Record = non-school based  content type
     *
     * This implementation uses Leaflet markerCluster for spidering proximate
     * locations of the same type: chapters and records. Clustering will be
     * disabled at the top level. This still requires two clustering groups,
     * each of which will be added to a layer switcher.
     */


    // Add basemap tiles and attribution. See leaflet-providers on github
    // for more base map options
    // var bUri = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
    var bUri1 = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
    var base1 = L.tileLayer(bUri1, {
        attribution: 'Basemap - data: <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors; design: <a href="https://carto.com/attributions">&copy;CARTO</a>'
    });

    var bUri2 = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    var base2 = L.tileLayer(bUri2, {
        attribution: 'Imagery <a href="http://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer">&copy;Esri</a>'
    });

    // SE == Story Episode
    const SE_TRANSCRIPT_SHOW_ALL = "ALL";

    let map = null;
    let sechaptersGroup = null;
    let recordsGroup = null;
    let sechaptersLayerUrl = null;
    let sechaptersLayer = null;
    let recordsLayerUrl = null;
    let recordsLayer = null;
    let seTranscriptFilter = SE_TRANSCRIPT_SHOW_ALL; /* only available in mapblock1 */
    let sechaptersReceived = false;
    let recordsReceived = false;
    let isFrontPage = false;

    let groupedNarrativeArea = null;
    let neHandler = null;

    let zoomPadding = {
        padding: L.point(40, 30)
    };

    let strokeOpacity = 0.75;
    let strokeColour = '#ED1100'
    let hoveredColour = '#0B30A0'; // fill colour when hovered

    let sechapterStyles = {
        opacity: strokeOpacity,
        weight: 3,
        color: strokeColour,
        fillOpacity: 1.0,
        fillColor: '#EDA200',
        radius: 6
    };

    let recordStyles = {
        opacity: strokeOpacity,
        weight: 3,
        color: strokeColour,
        fillOpacity: 1.0,
        fillColor: '#00B520',
        radius: 6
    };

    let mapDivId = 'map';

    // function zoomedPastThreshold(map, src) {
    //     let cz = map.getZoom();
    //     let mz = map.getMaxZoom();
    //     // console.log(src + ": current zoom: " + cz + " maxZoom: " + mz);
    //     if ((mz - 4) > cz) {
    //         return false;
    //     };
    //     return true;
    // };

    function zoomedPastThreshold(map, src) {
        return map.getZoom() > 12;
    };

    function createMap() {
        // Create map and set zoom (center below)
        map = L.map(mapDivId, {
            scrollWheelZoom: true,
            zoom: 12
        });

        map.spin(true, {
            color: "#016b83",
            lines: 20,
            length: 38,
            width: 12,
            animation: 'spinner-line-fade-more',
            speed: 0.75
        });

        map.on('load', function(e) {
            map.spin(false);
        });

        let bounds = L.latLngBounds(L.latLng(-89.9, -185), L.latLng(89.9, 185))
        map.setMaxBounds(bounds);
        map.on('drag', function() {
            map.panInsideBounds(bounds, { animate: false });
        });

        map.setMinZoom(1);
        map.setMaxZoom(18);

        // Add basemap to map - only one to avoid attribution concatenation.
        // map.addLayer(base1);
        map.attributionControl.setPrefix("");
        map.addLayer(base2);

        sechaptersGroup = L.markerClusterGroup({
            chunkedLoading: true,
            removeOutsideVisibleBounds: true,
            zoomToBoundsOnClick: false, // no default zoom - see zoomend and clusterclick
            showCoverageOnHover: false,
            // disableClusteringAtZoom: 12,
            iconCreateFunction: function(cluster) {
                return new L.DivIcon({
                    html: '<div><span>' + cluster.getChildCount() + '</span></div>',
                    className: 'marker-cluster marker-cluster-story-episode-chapter',
                    iconSize: new L.Point(40, 40)
                });
            }
        });
        map.addLayer(sechaptersGroup);
        recordsGroup = L.markerClusterGroup({
            chunkedLoading: true,
            removeOutsideVisibleBounds: true,
            zoomToBoundsOnClick: false, // no default zoom - see zoomend and clusterclick
            showCoverageOnHover: false,
            // disableClusteringAtZoom: 12,
            iconCreateFunction: function(cluster) {
                return new L.DivIcon({
                    html: '<div><span>' + cluster.getChildCount() + '</span></div>',
                    className: 'marker-cluster marker-cluster-record',
                    iconSize: new L.Point(40, 40)
                });
            }
        });
        map.addLayer(recordsGroup);

        map.on('zoomend',function(e){
            if (zoomedPastThreshold(map, 'zoomend')) {
                // highly zoomed - only identical locations remain clustered
                sechaptersGroup.freezeAtZoom("maxKeepSpiderfy");
                recordsGroup.freezeAtZoom("maxKeepSpiderfy");
            } else {
                // zoomed out - unfreeze clustering
                sechaptersGroup.unfreeze();
                recordsGroup.unfreeze();
            };
        });

        sechaptersGroup.on('clusterclick', function (e) {
            /*
             * limit zoom in on click.
             *
             * See zoomend handling above and the freezing / unfreezing
             * of clusters. If we have a cluster click, we are zoomed out.
             * Don't let it jump all the way into the full zoom levels.
             *
             * If we are already zoomed in, then don't zoom at all. The cluster
             * only controls the spiderify behaviour at this level.
             */
            if (!zoomedPastThreshold(map, 'clusterclick')) {
                // zoom - but limit level increment
                let cz = map.getZoom();
                let cBounds = e.layer.getBounds();
                map.fitBounds(cBounds, $.extend({}, zoomPadding, { maxZoom: cz + 3 }));
            };
        });
        recordsGroup.on('clusterclick', function (e) {
            /*
             * limit zoom in on click.
             *
             * See zoomend handling above and the freezing / unfreezing
             * of clusters. If we have a cluster click, we are zoomed out.
             * Don't let it jump all the way into the full zoom levels.
             *
             * If we are already zoomed in, then don't zoom at all. The cluster
             * only controls the spiderify behaviour at this level.
             */
            if (!zoomedPastThreshold(map, 'clusterclick')) {
                // zoom - but limit level increment
                let cz = map.getZoom();
                let cBounds = e.layer.getBounds();
                map.fitBounds(cBounds, $.extend({}, zoomPadding, { maxZoom: cz + 3 }));
            };
        });

        // L.control.scale({
        //     position: "bottomright",
        //     imperial: false,
        //     maxWidth: 115
        // }).addTo(map);
        let legends = [];
        legends.push($.extend({
            label: "Story episode - book chapter",
            type: "circle"
        }, sechapterStyles));
        legends.push($.extend({
            label: "",
            type: "polyline"
        }, sechapterStyles, { color: sechapterStyles.fillColor }));
        legends.push($.extend({
            label: "Record",
            type: "circle"
        }, recordStyles));
        legends.push($.extend({
            label: "",
            type: "polyline"
        }, recordStyles, { color: recordStyles.fillColor }));

        L.control.Legend({
            position: "bottomright",
            title: "Events",
            collapsed: true,
            legends: legends
        }).addTo(map)

        /*
         * Custom control for seTranscript selector
         */
        L.Control.Custom = L.Control.extend({
            options: {
                position: 'topright'
            },
            onRemove: function (map) {
                // Remove reference from map
                delete map.customControl;
            }
        });
    };

    // function extendLeafletClasses() {
    //     /*
    //      * Extend leaflet polygon and polyline classes so they can
    //      * participate in clustering.
    //      *
    //      * For each geometry type,
    //      *
    //      * 1) compute a polygon "center", use your favourite algorithm
    //      *    (centroid, etc.)
    //      * 2) provide getLatLng and setLatLng methods
    //      */
    //     L.Polygon.addInitHook(function() {
    //         this._latlng = this._bounds.getCenter();
    //     });

    //     L.Polygon.include({
    //         getLatLng: function() {
    //             return this._bounds.getCenter(); // this._latlng;
    //         },
    //         setLatLng: function() {} // Dummy method.
    //     });

    //     L.Polyline.addInitHook(function () {
    //         // @ts-ignore
    //         this._latlng = this._bounds.getCenter();
    //     });

    //     L.Polyline.include({
    //         getLatLng: function () {
    //             return this._bounds.getCenter();
    //         },
    //         setLatLng: function () {} // Dummy method.
    //     });
    // };

    /*
     * custom popup and tooltip bindings
     */
    function customTip(feature, layer, e) {
        let pOpen = false
        if (typeof layer.eachLayer == 'function') {
            layer.eachLayer(function (l) {
                l.closeTooltip();
                if (l.isPopupOpen()) {
                    pOpen = true;
                };
            });
            if (!pOpen && null != e.layer) {
                e.layer.openTooltip();
            };
        } else {
            layer.closeTooltip();
            if (!layer.isPopupOpen()) {
                layer.openTooltip();
            };
        };
    };

    function customPop() {
        // this.unbindTooltip();
        if (typeof this.eachLayer == 'function') {
            this.eachLayer(function (l) {
                l.closeTooltip();
            });
        } else {
            this.closeTooltip();
        };
    };

    let layerSwitcher = null;
    /*
     * array to track overlay layer status - when created, layers and
     * switcher are on to start, if layer is added to map (separate from
     * adding layer to switcher.
     */
    let overlayGroups = null;

    function createLayerSwitcher() {
        let ov = {
            'Story episode - book chapter': sechaptersGroup,
            'Record': recordsGroup
        };

        for (let lyr in ov) {
            /*
             * first time - load all layers; subsequent times, restore layer
             * state after refiltering map features.
             */
            if (!removeHasRun || overlayGroups[lyr]) {
                ov[lyr].addTo(map);
            };
        };

        layerSwitcher = L.control.layers(
            { 'Carto Voyager': base1, 'ESRI Imagery': base2 },
            ov,
            { position: "bottomleft" }
        );
        layerSwitcher.addTo(map);
    };

    let removeHasRun = false;
    function removeLayerSwitcher() {
        /* capture status of overlays in map before destroying switcher */
        overlayGroups = {};

        if (layerSwitcher != null) {
            layerSwitcher._layers.forEach(function(obj) {
                let groupName = null;

                // check if layer is an overlay
                if (obj.overlay) {
                    // get name of overlay
                    groupName = obj.name;
                    // store whether it's present on the map or not
                    overlayGroups[groupName] = map.hasLayer(obj.layer);
                    map.removeLayer(obj.layer);
                };
            });
        };

        sechaptersGroup.removeLayer(sechaptersLayer);
        sechaptersLayer = null;
        recordsGroup.removeLayer(recordsLayer);
        recordsLayer = null;
        if (layerSwitcher != null) {
            map.removeControl(layerSwitcher);
            layerSwitcher = null;
        };

        removeHasRun = true;
    };

    function addLayersAndCentre() {
        if (sechaptersLayer == null || recordsLayer == null) {
            // one not yet complete or at least one failure
            return;
        };

        if (!isFrontPage &&
            sechaptersLayer.getLayers().length == 0 &&
            recordsLayer.getLayers().length == 0) {
            $('#' + mapDivId).empty().removeClass().text("No contributions yet.");
            return;
        };

        sechaptersGroup.addLayer(sechaptersLayer);
        recordsGroup.addLayer(recordsLayer);

        /*
         * With markercluster, we have the data by this point.
         * Zoom to bounding box extent of the sechapter and
         * record groups or predefined map zoom extents, adjusted to not hide markers
         * behind map controls
         */
        let b1 = sechaptersLayer.getBounds();
        let b2 = recordsLayer.getBounds();
        let b = L.latLngBounds(L.latLng(44, -115), L.latLng(60, -70));

        if (seTranscriptFilter != SE_TRANSCRIPT_SHOW_ALL &&
            groupedNarrativeArea != "" &&
            isFrontPage) {
            let temp = neHandler.getExtentFromEpisodeId(seTranscriptFilter);
            if (temp !== null){
                b1 = b2 = temp;
            };
        };

        if (!b1.isValid() || !b2.isValid()) {
            if (!b1.isValid()) {
                if (b2.isValid()) {
                    b = b2;
                };
            } else {
                if (b1.isValid()) {
                    b = b1;
                };
            };
        } else {
            b = b1.extend(b2);
        };
        map.fitBounds(b, zoomPadding);

        createLayerSwitcher(); /* adds groups to map, according to last known status */
    };

    const p = 'properties';
    const t = 'transcript';
    function getTranscriptId(obj) { /* works for records and book chapters */
        if (obj.hasOwnProperty(p) &&
            obj[p].hasOwnProperty(t) &&
            obj[p][t] != '') {
            return obj[p][t];
        };
        return null;
    };

    let _initialLoadsPending = 2;
    function loadLayers() {
        let chapterURL = sechaptersLayerUrl;
        if (seTranscriptFilter != SE_TRANSCRIPT_SHOW_ALL) {
            chapterURL += "/" + seTranscriptFilter;
        };

        $.getJSON(chapterURL, function(data) {
            if (isFrontPage && _initialLoadsPending > 0) {
                neHandler.createNarrativeItemsSet(
                    sechaptersLayerUrl, getTranscriptId, data);
            };
            _initialLoadsPending -= 1;

            let foundRefs = {};
            let dropflag = 'DROPME';
            if (isFrontPage) {
                data.features.forEach(function(feature) {
                    /*
                     * bugs in Drupal views with relations can cause repeats of rows with minor
                     * variations. This has been showing up in this GeoJSON view as repeated
                     * chapters with each carrying one different related photo when that
                     * chapter references multiple records.
                     *
                     * When a feature ID is first seen, remember it. If the ID is seen again,
                     * drop the repeat row but concatenate the related_photos field to the
                     * earlier row's related_photos.
                     */
                    if ("properties" in feature) {
                        if (!(feature.properties.record in foundRefs)) {
                            foundRefs[feature.properties.record] = feature;
                        } else {
                            let old = foundRefs[feature.properties.record];
                            if ("related_photos" in old.properties) {
                                old.properties.related_photos =
                                    old.properties.related_photos.concat(feature.properties.related_photos);
                            };
                            feature.properties[dropflag] = true;
                        };
                    };
                });
            };

            sechaptersLayer = L.geoJson(data, {
                filter: function (feature) {
                    // filter rows marked for dropping in the preprocessing scan above.
                    if (dropflag in feature.properties) {
                        return false;
                    } else {
                        return true;
                    };
                },
                style: function(feature) {
                    let s = $.extend({}, sechapterStyles);
                    s.fallbackColour = s.fillColor;
                    if (feature.geometry.type == 'LineString' ||
                        feature.geometry.type == 'MultiLineString') {
                        //s.weight *= 3;
                        s.color = s.fillColor; /* linear: differentiate with stroke color */
                    } else if (feature.geometry.type == 'Polygon' ||
                               feature.geometry.type == 'MultiPolygon') {
                        //s.weight *= 3;
                    };
                    return s;
                },
                pointToLayer: function (feature, latlng) {
                    marker = L.circleMarker(latlng, sechapterStyles);
                    return marker;
                },
                onEachFeature: function(feature, layer) {
                    let popupText = '<div>' +
                        feature.properties.name + '<br/>' +
                        'Transcript: ' + feature.properties.transcripturl + '<br/>' +
                        'Setting: ' + feature.properties.settingurl + '<br/>' +
                        feature.properties.field_photos + '<br/>' +
                        feature.properties.field_audio;
                    if (isFrontPage) {
                        popupText = popupText.concat('<br/>',
                                                     feature.properties.related_photos,
                                                     '</div>');
                    }  else {
                        popupText = popupText.concat('</div>');                        
                    };

                    /*
                     * multipoint, multipolygon and pultilinestring have a layer
                     * for each non-multi component. Attach the popup for each
                     * of those.
                     */
                    if (typeof layer.eachLayer == 'function') {
                        layer.eachLayer(function (l) {
                            l.bindPopup(popupText, {
                                minWidth: 225,
                                maxHeight: 200
                            });
                            l.bindTooltip(feature.properties.name, {
                                direction: "center",
                                sticky: true,
                                offset: L.point(0, 25),
                                opacity: 0.80
                            });
                        });
                    } else {
                        layer.bindPopup(popupText, {
                            minWidth: 225,
                            maxHeight: 200
                        });
                        layer.bindTooltip(feature.properties.name, {
                            direction: "center",
                            sticky: true,
                            offset: L.point(0, 25),
                            opacity: 0.80
                        });
                    };
                    // mouseover/mouseout fill highlighting for hover
                    layer.on('mouseover', function(e) {
                        this.setStyle({
                            fillColor: hoveredColour,
                            opacity: 1.0
                        });
                        customTip(feature, layer, e);
                        this.bringToFront();
                    });
                    layer.on('mouseout', function(e) {
                        let t = e.target;
                        this.setStyle({
                            fillColor: t.options['fallbackColour'],
                            opacity: strokeOpacity
                        });
                    });
                    layer.on('click', customPop, layer);
                }
            });

            buildTranscriptList(true, data);
            addLayersAndCentre();
        }).fail(function(jqXHR, textStatus, errorThrown) {
            if (jqXHR.status == 403) {
                $('#' + mapDivId).empty().removeClass().text("No access to another user's work.");
                return;
            };
            $('#' + mapDivId).empty().removeClass().text("Unknown error: " + status);
            return;
        });

        let recordURL = recordsLayerUrl;
        if (seTranscriptFilter != SE_TRANSCRIPT_SHOW_ALL) {
            recordURL += "/" + seTranscriptFilter;
        };

        $.getJSON(recordURL, function(data) {
            if (isFrontPage && _initialLoadsPending > 0) {
                neHandler.createNarrativeItemsSet(
                    recordsLayerUrl, getTranscriptId, data);
            };
            _initialLoadsPending -= 1;

            recordsLayer = L.geoJson(data, {
                pointToLayer: function (feature, latlng) {
                    marker = L.circleMarker(latlng, recordStyles);
                    return marker;
                },
                onEachFeature: function(feature, layer) {
                    /*
                     * Set up styles - done here rather than in a style option function because
                     * this geojson can contain: 1) points, 2) linestring / multilinestring,
                     * 3) polygon / multipolygon, 4) geometrycollections made up of any of the
                     * above. The latter does not work at all with the style option function
                     * because there is no good way to drill into the collection in that context.
                     */
                    let s = $.extend({}, recordStyles);
                    s.fallbackColour = s.fillColor;
                    if (layer.feature.geometry.type == 'Point' ||
                        layer.feature.geometry.type == 'Polygon' ||
                        layer.feature.geometry.type == 'MultiPolygon') {
                        // all the same - outline / fill
                        layer.setStyle(s);
                    } else if (layer.feature.geometry.type == 'LineString' ||
                               layer.feature.geometry.type == 'MultiLineString') {
                        // just lines
                        //s.weight *= 2;
                        s.color = s.fillColor; /* linear: differentiate with stroke color */
                        layer.setStyle(s);
                    } else if (layer.feature.geometry.type == 'GeometryCollection') {
                        // deal with array of elements
                        let sa = [];
                        layer.feature.geometry.geometries.forEach(function(g) {
                            let s2 = $.extend({}, recordStyles);
                            s2.fallbackColour = s2.fillColor;
                            if (g.type == 'LineString' ||
                                g.type == 'MultiLineString') {
                                //s2.weight *= 2;
                                s2.color = s2.fillColor; /* linear: differentiate with stroke color */
                            };
                            sa.push(s2);
                        });
                        let li = 0;
                        layer.eachLayer(function(l) {
                            l.setStyle(sa[li]);
                            li += 1;
                        });
                    };

                    /*
                     * Set up pop-ups
                     */
                    let popupText = '<div>' +
                        feature.properties.name + '<br/>' +
                        'Transcript: ' + feature.properties.transcripturl + '<br/>';
//                    if (feature.properties.field_memory_type != '') {
//                        popupText += 'Event type: ' + feature.properties.field_memory_type + '</br>';
//                    };
                    popupText +=
                        feature.properties.field_photos + '<br/>' +
                        feature.properties.field_audio + '</div>';
                    /*
                     * multipoint, multipolygon and multilinestring have a layer
                     * for each non-multi component. Attach the popup for each
                     * of those.
                     */
                    if (typeof layer.eachLayer == 'function') {
                        layer.eachLayer(function (l) {
                            l.bindPopup(popupText, {
                                minWidth: 225,
                                maxHeight: 200
                            });
                            l.bindTooltip(feature.properties.name, {
                                direction: "center",
                                sticky: true,
                                offset: L.point(0, 25),
                                opacity: 0.80
                            });
                        });
                    } else {
                        layer.bindPopup(popupText, {
                            minWidth: 225,
                            maxHeight: 200
                        });
                        layer.bindTooltip(feature.properties.name, {
                            direction: "center",
                            sticky: true,
                            offset: L.point(0, 25),
                            opacity: 0.80
                        });
                    };

                    // mouseover/mouseout fill highlighting for hover
                    layer.on('mouseover', function(e) {
                        this.setStyle({
                            fillColor: hoveredColour,
                            opacity: 1.0
                        });
                        customTip(feature, layer, e);
                        this.bringToFront();
                    });
                    layer.on('mouseout', function(e) {
                        /*
                         * Seems to be two cases here:
                         * 1) With an assortment of geometries created for a single
                         * feature (stored as geometrycollection), the event fires
                         * on the feature which contains a
                         * link to its layer where the styling is applied.
                         *
                         * 2) Simple feature - event fires on the layer. Style that.
                         */
                        if (typeof layer.eachLayer == 'function') {
                            layer.eachLayer(function (l) {
                                l.setStyle({
                                    fillColor: e.layer.options['fallbackColour'],
                                    opacity: strokeOpacity
                                });
                            });
                        } else {
                            this.setStyle({
                                fillColor: this.options['fallbackColour'],
                                opacity: strokeOpacity
                            });
                        };
                    });
                    layer.on('click', customPop, layer);
                }
            });

            buildTranscriptList(false, data);
            addLayersAndCentre();
        }).fail(function(jqXHR, textStatus, errorThrown) {
            if (jqXHR.status == 403) {
                $('#' + mapDivId).empty().removeClass().text("No access to another user's work.");
                return;
            };
            $('#' + mapDivId).empty().removeClass().text("Unknown error: " + status);
            return;
        });
    };

    // set up seTranscript filter dropdown based on layer data returned. Initially map
    // is loaded without filter.
    let sechapterTranscriptList = null;
    let recordTranscriptList = null;

    function loadTranscriptList(list, data) {
        /*
         * Transcript UI list: feature filter uses transcript IDs. The lists
         * are ordered with "all shown" first, followed by sorting based on
         * "order" values, if one or both are defined (defined order always
         * beats a NULL), and name field as a tie-breaker.
         */
        data.features.forEach(function(s) {
            list.push({
                value: s.properties.transcript,
                name: s.properties.transcript_name,
                order: s.properties.order != '' ? parseInt(s.properties.order) : null,
                g_narr_area: s.properties.g_narr_area
            });
        });
    };

    /*
     * chapters: true => story episode book chapters being processed, otherwise
     *           records are being processed.
     *
     * NOTE: function only fully executes to build UI list once - see
     *       sechaptersReceived and recordsReceived flag handling.
     */
    function buildTranscriptList(chapters, data) {
        if (!isFrontPage) { // don't load this on a user page
            return;
        };

        if (chapters && !sechaptersReceived) {
            sechapterTranscriptList = [];
            loadTranscriptList(sechapterTranscriptList,
                             { features: [
                                 {
                                     properties: {
                                         transcript: SE_TRANSCRIPT_SHOW_ALL,
                                         transcript_name: "All episodes",
                                         order: -65535,
                                         g_narr_area: ""
                                     }
                                 }
                             ]});
            loadTranscriptList(sechapterTranscriptList, data);
            sechaptersReceived = true; // not reset - dropdown menu only built with first data
        } else if (!recordsReceived) {
            recordTranscriptList = [];
            loadTranscriptList(recordTranscriptList, data);
            recordsReceived = true; // not reset - dropdown menu only built with first data
        };

        if (sechapterTranscriptList == null ||
            recordTranscriptList == null) {   // still awaiting a list
            return;
        };

        let combined = sechapterTranscriptList.concat(recordTranscriptList);
        combined.sort(function(a, b) {
            function nameSort(aa, bb) {
                let nameA = aa.name.toUpperCase();
                let nameB = bb.name.toUpperCase();
                if (nameA < nameB) {
                    return -1;
                };
                if (nameA > nameB) {
                    return 1;
                };
                return 0;
            };
            
            if (a.value == SE_TRANSCRIPT_SHOW_ALL) {
                return -1;
            } else if (b.value == SE_TRANSCRIPT_SHOW_ALL) {
                return 1;
            } else {
                if ((a.order === null && b.order === null) ||
                    (a.order !== null && b.order !== null)) {
                    /* sort by order but break ties using name */
                    if (a.order == b.order) {
                        return nameSort(a, b);
                    } else {
                        return a.order - b.order;
                    };
                } else if (a.order !== null) {
                    return -1; /* any order comes before undefined */
                };
                return 1; /* b has order and not a */
            };
        });

        /* as name indicates, strip non-unique entries for UI list */
        let unique = []
        for (let i = 0; i < combined.length; i++) {
            let found = false;
            for (let j = 0; j < unique.length; j++) {
                if (combined[i].value == unique[j].value) {
                    found = true;
                    break;
                };
            };
            if (!found) {
                unique.push(combined[i]);
            };
        };

        let options = "";
        let idx = 1;
        unique.forEach(function(s) {
            options += '<option value="' + s.value;
            if (s.value == seTranscriptFilter) {
                options += '" selected="selected';
            };
            if (s.g_narr_area != "") {
                options += '" g_narr_area="' + s.g_narr_area;
            };
            if (s.value == SE_TRANSCRIPT_SHOW_ALL) {
                options += '">' + s.name + '</option>';
            } else {
                options += '">' + idx++ + ". " + s.name + '</option>';
            };
        });

        if (map.customControl) {
            map.removeControl(map.customControl);
        };

        let selector = new L.Control.Custom();
        selector.onAdd = function (map) {
            let div = L.DomUtil.create("div", "info legend");
            div.innerHTML = '<select id="setting_list">' + options + '</select>';
            div.firstChild.onmousedown = div.firstChild.ondblclick = L.DomEvent.stopPropagation;

            map.customControl = selector; // mark control so it can be found later
            return div;
        };
        selector.addTo(map); // note: this sets map.customControl

        $("#setting_list").change(function(){
            let first = true; /* ensure that only one selected value handled */
            $("#setting_list option:selected").each(function() {
                if (first) {
                    seTranscriptFilter = $(this).val();
                    groupedNarrativeArea = $(this).attr('g_narr_area');
                    first = false;
                };
            });

            removeLayerSwitcher();
            loadLayers();
        });
    };

    window.mapblock = {};
    window.mapblock.initMap = function(chaptersURL, recordsURL, frontPage) {
        /*
         * frontPage: if true, load the transcript's dropdown list and show
         *            the map if empty. On a user page map, neither of those
         *            things will be true.
         */

        sechaptersLayerUrl = chaptersURL;
        recordsLayerUrl = recordsURL;
        isFrontPage = frontPage;

        if (isFrontPage) {
            url = window.location.protocol + '//' + window.location.host +
                DS.path.baseUrl + 'grouped_narrative_areas';
            neHandler = window.NarrativeExtents();
            neHandler.init({
                url: url,
                getNEIdFn: function(obj) {
                    return obj.id;
                },
                getNISFn: function(obj) {
                    /*
                     * Narrative items set in the narrative extents of
                     * this atlas are comma-separated lists of integers in
                     * string format. Convert to array (still strings - just
                     * used as identifiers).
                     */
                    return obj.narrativeItemsSet.replace(/\s/g, '').split(',');
                },
                getEpisodeIdFn: function(obj) {
                    /*
                     * If multiple episodes reference the same narrative
                     * extent, then this gives multiple entries showing the
                     * NE and the NIS, each with an unique episode ID.
                     */
                    return obj.episode_id;
                },
                divid: 'map',
                expectedNarrativeItemSetNames: [
                    sechaptersLayerUrl, recordsLayerUrl
                ]
            });
        };

        createMap();
        //extendLeafletClasses();
        loadLayers();
    };
})(jQuery, window.drupalSettings);
