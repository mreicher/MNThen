document.addEventListener("DOMContentLoaded", function () {
  var map = L.map("map", {
    attributionControl: false,
  }).setView([45.09384047720653, -92.99761868394353], 18);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20,
    id: "mapbox/streets-v11",
    tileSize: 512,
    zoomOffset: -1,
  }).addTo(map);

  L.control.attribution({
    prefix: false,
  }).addTo(map);

  var userLocationMarker = L.circleMarker([0, 0], {
    color: "red",
    fillColor: "#f03",
    fillOpacity: 0.5,
    radius: 10,
  }).addTo(map);

  var thresholdFeet = 50; // Threshold distance in feet

  function updateUserLocation(e) {
    var userLatLng = e.latlng;
    userLocationMarker.setLatLng(userLatLng);
    map.setView(userLatLng);

    for (var i = 0; i < locations.length; i++) {
      var location = locations[i];
      var locationLatLng = L.latLng(location.lat, location.lng);
      var distance = userLatLng.distanceTo(locationLatLng);
      var distanceFeet = Math.floor(distance * 3.28084); // Convert to feet and round down
      var distanceFeetInt = parseInt(distanceFeet); // Convert to integer

      var popupContent =
        "<b>" +
        location.name +
        "</b><br>Distance: " +
        distanceFeetInt +
        " feet";

      var popupOptions = {
        autoClose: false,
      };

      var marker = L.marker(locationLatLng).bindPopup(
        popupContent,
        popupOptions
      );

      marker.addTo(map);

      // Check if the user is within the threshold distance
      if (distanceFeet <= thresholdFeet) {
        window.location.href = location.htmlFile;
      }
    }
  }

  function onLocationError(e) {
    alert("Failed to access your location. Please make sure location services are enabled and try again.");
  }

  map.on("locationfound", updateUserLocation);
  map.on("locationerror", onLocationError);

  map.locate({
    watch: true,
    enableHighAccuracy: true,
    maximumAge: 0,
  });
});
