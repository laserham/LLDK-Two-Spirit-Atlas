(function ($, DS) {
    url = window.location.protocol + '//' + window.location.host + DS.path.baseUrl;
    
    // Add basemap tiles and attribution. See leaflet-providers on github
    // for more base map options
    // var bUri = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
    var bUri1 = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
    var base1 = L.tileLayer(bUri1, {
        attribution: 'Basemap &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>'
    });

    bUri2 = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    var base2 = L.tileLayer(bUri2, {
        attribution: 'Imagery &copy; <a href="http://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer">Esri</a>'
        // &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    });
    
    // Add SchoolBasedMemory.
    var strokeOpacity = 0.75;
    var strokeColour = '#ED1100'
    // var strokeColours = {
    //     'Housing': '#8b0028',
    //     'Road Design or Use': '#024e60',
    //     'Land Use': '#3c8900',
    //     'Other': '#c56200'
    // };
    var hoveredColour = '#0B30A0'; // fill colour when hovered

    var schoolBasedMemoryStyles = {
        opacity: strokeOpacity,
        weight: 3,
        color: strokeColour,
        fillOpacity: 1.0,
        fillColor: '#EDA200',
        radius: 6
    };

    var nonSchoolBasedMemoryStyles = {
        opacity: strokeOpacity,
        weight: 3,
        color: strokeColour,
        fillOpacity: 1.0,
        fillColor: '#00B520',
        radius: 6
    };

    var throughLineStyle = {
        weight: 4,
        color: strokeColour
    };

    /*
     * Extend leaflet polygon and polyline classes so they can
     * participate in clustering.
     * 
     * For each geometry type, 
     * 
     * 1) compute a polygon "center", use your favourite algorithm
     *    (centroid, etc.)
     * 2) provide getLatLng and setLatLng methods
     */
    L.Polygon.addInitHook(function() {
        this._latlng = this._bounds.getCenter();
    });

    L.Polygon.include({
        getLatLng: function() {
            return this._bounds.getCenter(); // this._latlng;
        },
        setLatLng: function() {} // Dummy method.
    });

    L.Polyline.addInitHook(function () {
        // @ts-ignore
        this._latlng = this._bounds.getCenter();
    });

    L.Polyline.include({
        getLatLng: function () {
            return this._bounds.getCenter();
        },
        setLatLng: function () {} // Dummy method.
    });

    /*
     * Custom control for survivor selector
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
    
    /*
     * custom popup and tooltip bindings
     */
    function customTip(feature, layer, e) {
        var pOpen = false
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
    
    /*
     * Markercluster and geoJSON_BBOX do not work together:
     * - Leaflet markercluster implementation picks up POINT markers
     *   only from "child" layers, not groups.
     * - It creates an array of managed markers and clusters those.
     * - Groups are skipped to be handled without clustering.
     * - For a bounding box to be effective, it needs to be handled
     *   as a grouped layer to refetch geojson as the bounding box
     *   updates and would therefore also need to know which markers
     *   have moved into the clustering array.
     * 
     * Leaflet marker cluster also has other limitations:
     * - ignores non-point geometries: see local fixes above
     *
     * Leaflet markercluster has volume management built in to
     * chunk the rendering of large point collections without 
     * stopping the rendering browser from doing other things.
     * I don't think it does anything to assist with the data
     * transfer for the vector layer to be rendered. Essentially
     * you have to wait for an ajax call to complete and hand
     * over all the data to the markercluster implementation.
     */
    /* as above disable BBOX to use markercluster. */
    // schoolBasedMemoryLayer = L.geoJSON_BBOX({
    //     endpoint: url + 'school_based_memory_geojson_feed',
    //     usebbox: true,
    //     enctype: 'plain',
    //     replace: true,
    //     debug: false,
    //     maxRequests: 3,
    //     after: function (data) {
    //         if (schoolBasedMemoryLayer.options.debug) {
    //             console.debug('feature count: ' + data.features.length +
    //                           ' total: ' + schoolBasedMemoryLayer.getLayers().length);
    //         };
    //     }
    // }, {
    /* explicity fetch the schoolBasedMemory layer - create the layer */
    const SURVIVOR_SHOW_ALL = "-1";
    
    var map = null;
    var mGroup = null;
    var schoolBasedMemoryLayer = null;
    var nonSchoolBasedMemoryLayer = null;
    var survivorFilter = SURVIVOR_SHOW_ALL;
    var sbEventsReceived = false;
    var nsbEventsReceived = false;
    
    function createMap() {
        // Create map and set zoom (center below)
        map = L.map('map', {
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
        
        var bounds = L.latLngBounds(L.latLng(-89.9, -185), L.latLng(89.9, 185))
        map.setMaxBounds(bounds);
        map.on('drag', function() {
            map.panInsideBounds(bounds, { animate: false });
        });

        map.setMinZoom(1);

        // Add basemap to map - only one to avoid attribution concatenation.
        // map.addLayer(base1);
        map.addLayer(base2);

        mGroup = L.markerClusterGroup({
            chunkedLoading: true
        });
        map.addLayer(mGroup);

        L.control.layers({
            'Carto Voyageur': base1,
            'ESRI Imagery': base2
        },
        {
            //'School-based memory': mGroup, // separate check-boxes in the group don't work wthout extra subgroup software.
            //'Non-school-based memory': mGroup
            'Memories': mGroup
        },
        { position: "bottomleft" }).addTo(map);

        L.control.scale({
            position: "bottomright",
            imperial: false,
            maxWidth: 115
        }).addTo(map);
    };

    /*
     * Through line info: array of structures containing coords and sort criteria.
     * In this prototype code, the coords actually are the sort criteria but that 
     * could change to some attribute(s).
     */
    var survivorThroughLineInfo = [];
    var throughLineLayer = null;
    function createPolylineFromSortedCoords(info) {
        if (info.length <= 1) {
            return null;
        };

        info.sort(function(a, b) {
            if (a.lng < b.lng) {
                return -1;
            } else if (a.lng > b.lng) {
                return 1;
            } else {
                if (a.lat < b.lat) {
                    return -1;
                } else if (a.lat > b.lat) {
                    return 1;
                };
            };
            return 0;
        });
        return L.polyline(info);
    };

    function addLayersAndCentre() {
        if (schoolBasedMemoryLayer == null || nonSchoolBasedMemoryLayer == null) {
            return;
        }
        
        /* 
         * We have the data - now push it into the markercluster
         * group
         */
        mGroup.addLayer(schoolBasedMemoryLayer);
        mGroup.addLayer(nonSchoolBasedMemoryLayer);
        
        if (SURVIVOR_SHOW_ALL != survivorFilter) {
            throughLineLayer = createPolylineFromSortedCoords(survivorThroughLineInfo);
            if (null != throughLineLayer) {
                map.addLayer(throughLineLayer);
                throughLineLayer.setStyle({
                    color: throughLineStyle.color,
                    weight: throughLineStyle.weight
                });
                throughLineLayer.bringToBack();
            };
        };

        // center on Toronto - not ideal for students working in other areas
        // but probably reduces unnecessary scrolling overall.
        //map.setView([35, -25], 2);
        
        /* 
         * Now use markercluster and have the data by this point.
         * Zoom to bounding box extent of the schoolBasedMemory and 
         * nonSchoolBasedMemory groups, adjusted to not hide markers 
         * behind map controls
         */
        var b1 = schoolBasedMemoryLayer.getBounds();
        var b2 = nonSchoolBasedMemoryLayer.getBounds();
        var p = {
            padding: L.point(40, 30),
            maxZoom: 16
        };
        var b = L.latLngBounds(L.latLng(44, -115), L.latLng(60, -70));
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
        map.fitBounds(b, p);
    };

    function loadLayers() {
        var sbmURL = url + 'school_based_memory_geojson_feed';
        if (survivorFilter != SURVIVOR_SHOW_ALL) {
            sbmURL += "/" + survivorFilter;
        };
        
        $.getJSON(sbmURL, function(data) {
            schoolBasedMemoryLayer = L.geoJson(data, {
                style: function(feature) {
                    var s = $.extend({}, schoolBasedMemoryStyles);
                    // for (const [key, value] of Object.entries(strokeColours)) {
                    //     if (feature.properties.field_evidence_types.indexOf(key) != -1) {
                    //         s.color = value;
                    s.fallbackColour = s.fillColor;
                    if (feature.geometry.type == 'LineString' ||
                        feature.geometry.type == 'MultiLineString') {
                        s.weight *= 3;
                    } else if (feature.geometry.type == 'Polygon' ||
                               feature.geometry.type == 'MultiPolygon') {
                        s.weight *= 3;
                    };
                    //     break;
                    // };
                    // };
                    return s;
                },
                pointToLayer: function (feature, latlng) {
                    marker = L.circleMarker(latlng, schoolBasedMemoryStyles);
                    return marker;
                },
                onEachFeature: function(feature, layer) {
                    var popupText = '<div>' +
                        feature.properties.name + '<br/>' +
                        'Survivor: ' + feature.properties.survivorurl + '<br/>' +
                        'School: ' + feature.properties.schoolurl + '<br/>' +
                        feature.properties.field_photos + '<br/>' +
                        feature.properties.field_audio + '</div>';
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
                    });
                    layer.on('mouseout', function(e) {
                        var t = e.target;
                        this.setStyle({
                            fillColor: t.options['fallbackColour'],
                            opacity: strokeOpacity
                        });
                    });
                    layer.on('click', customPop, layer);

                    /* 
                     * use getLatLng functions created above to fetch a representative
                     * point for the feature
                     */
                    survivorThroughLineInfo.push(layer.getLatLng());
                }
            });

            buildSurvivorList(true, data);
            addLayersAndCentre();
        });

        var nsbmURL = url + 'non_school_based_memory_geojson_feed';
        if (survivorFilter != SURVIVOR_SHOW_ALL) {
            nsbmURL += "/" + survivorFilter;
        };
        
        $.getJSON(nsbmURL, function(data) {
            nonSchoolBasedMemoryLayer = L.geoJson(data, {
                style: function(feature) {
                    var s = $.extend({}, nonSchoolBasedMemoryStyles);
                    // for (const [key, value] of Object.entries(strokeColours)) {
                    //     if (feature.properties.field_evidence_types.indexOf(key) != -1) {
                    //         s.color = value;
                    s.fallbackColour = s.fillColor;
                    if (feature.geometry.type == 'LineString' ||
                        feature.geometry.type == 'MultiLineString') {
                        s.weight *= 3;
                    } else if (feature.geometry.type == 'Polygon' ||
                               feature.geometry.type == 'MultiPolygon') {
                        s.weight *= 3;
                    };
                    //     break;
                    // };
                    // };
                    return s;
                },
                pointToLayer: function (feature, latlng) {
                    marker = L.circleMarker(latlng, nonSchoolBasedMemoryStyles);
                    return marker;
                },
                onEachFeature: function(feature, layer) {
                    var popupText = '<div>' +
                        feature.properties.name + '<br/>' +
                        'Survivor: ' + feature.properties.survivorurl + '<br/>';
                    if (feature.properties.field_memory_type != '') {
                        popupText += 'Event type: ' + feature.properties.field_memory_type + '</br>';
                    };
                    popupText +=
                        feature.properties.field_photos + '<br/>' +
                        feature.properties.field_audio + '</div>';
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
                    });
                    layer.on('mouseout', function(e) {
                        var t = e.target;
                        this.setStyle({
                            fillColor: t.options['fallbackColour'],
                            opacity: strokeOpacity
                        });
                    });
                    layer.on('click', customPop, layer);

                    /* 
                     * use getLatLng functions created above to fetch a representative
                     * point for the feature
                     */
                    survivorThroughLineInfo.push(layer.getLatLng());
                }
            });
            
            buildSurvivorList(false, data);
            addLayersAndCentre();
        });
    };

    // set up survivor filter dropdown based on layer data returned. Initially map
    // is loaded without filter.
    var schoolBasedEventSurvivorList = null;
    var nonSchoolBasedEventSurvivorList = null;

    function loadSurvivorList(list, data) {
        data.features.forEach(function(s) {
            list.push({
                value: s.properties.survivor,
                name: s.properties.survivor_name
            });
        });
    };

    function buildSurvivorList(schoolBased, data) {
        if (schoolBased && !sbEventsReceived) {
            schoolBasedEventSurvivorList = [];
            loadSurvivorList(schoolBasedEventSurvivorList,
                             { features: [
                                 {
                                     properties: {
                                         survivor: SURVIVOR_SHOW_ALL,
                                         survivor_name: "Memories: all survivors"
                                     }
                                 }
                             ]});
            loadSurvivorList(schoolBasedEventSurvivorList, data);
            sbEventsReceived = true; // not reset - dropdown menu only built with first data
        } else if (!nsbEventsReceived) {
            nonSchoolBasedEventSurvivorList = [];
            loadSurvivorList(nonSchoolBasedEventSurvivorList, data);
            nsbEventsReceived = true; // not reset - dropdown menu only built with first data
        };

        if (schoolBasedEventSurvivorList == null ||
            nonSchoolBasedEventSurvivorList == null) {   // still awaiting a list
            return;
        };

        var combined = schoolBasedEventSurvivorList.concat(nonSchoolBasedEventSurvivorList);
        combined.sort(function(a, b) {
            if (a.value == SURVIVOR_SHOW_ALL) {
                return -1;
            } else if (b.value == SURVIVOR_SHOW_ALL) {
                return 1;
            } else {
                var nameA = a.name.toUpperCase();
                var nameB = b.name.toUpperCase();
                if (nameA < nameB) {
                    return -1;
                };
                if (nameA > nameB) {
                    return 1;
                };
                return 0;
            };
        });
        var unique = []
        for (let i = 0; i < combined.length; i++) {
            var found = false;
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

        var options = "";
        unique.forEach(function(s) {
            options += '<option value="' + s.value;
            if (s.value == survivorFilter) {
                options += '" selected="selected';
            };
            options += '">' + s.name + '</option>'; 
        });

        if (map.customControl) {
            map.removeControl(map.customControl);
        };
        
        selector = new L.Control.Custom();
        selector.onAdd = function (map) {
            var div = L.DomUtil.create("div", "info legend");
            div.innerHTML = '<select id="survivor_list">' + options + '</select>';
            div.firstChild.onmousedown = div.firstChild.ondblclick = L.DomEvent.stopPropagation;

            map.customControl = selector; // mark control so it can be found later
            return div;
        };
        selector.addTo(map); // note: this sets map.customControl

        $("#survivor_list").change(function(){
            var first = true;
            $("#survivor_list option:selected").each(function() {
                if (first) {
                    survivorFilter = $(this).val();
                    first = false;
                };
            });

            mGroup.clearLayers();
            schoolBasedMemoryLayer = null;
            nonSchoolBasedMemoryLayer = null;

            if (null != throughLineLayer) {
                map.removeLayer(throughLineLayer);
            };
            survivorThroughLineInfo = [];
            throughLineLayer = null;

            loadLayers();
        });
    };

    createMap();
    loadLayers();
})(jQuery, window.drupalSettings);
