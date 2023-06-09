document.addEventListener("DOMContentLoaded", function () {

  var map = L.map("map", {

    attributionControl: false,

  }).setView([44.992317998619704, -93.2687030266857], 18); 

// Starting location is Boom Island Park
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


  var thresholdFeet = 10; // Threshold distance in feet

  var tourSwitchDelay = 2000; // Delay in milliseconds


  var statusMessageContainer = document.getElementById("status-message-container");

  var statusMessage = document.getElementById("status-message");


  var locatingTimeout;

  var isTracking = false;

  function updateUserLocation(e) {

    clearTimeout(locatingTimeout); // Clear the locating timeout


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

        setTimeout(function () {

          window.location.href = location.htmlFile;

        }, tourSwitchDelay);

        return; // Exit the function if location is found

      }

    }

  }

  function onLocationError(e) {

    clearTimeout(locatingTimeout); // Clear the locating timeout


    statusMessage.innerHTML = "Device location not found. Please try again.";

    statusMessageContainer.style.display = "block"; // Show the status message container


    setTimeout(function () {

      statusMessageContainer.style.display = "none";

    }, 3000); // Adjust the duration as needed (in milliseconds)

  }

  function startLocating() {

    statusMessage.innerHTML = "Searching for your location...";

    statusMessageContainer.style.display = "block"; // Show the status message container


    locatingTimeout = setTimeout(function () {

      onLocationError();

    }, 9000); // Adjust the duration as needed (in milliseconds)


    map.locate({

      watch: false, // Set watch to false initially

      enableHighAccuracy: true,

      maximumAge: 0,

    });

    map.on("locationfound", function (e) {

      updateUserLocation(e); // Call updateUserLocation when location is found


      if (!isTracking) {

        isTracking = true;

        map.locate({

          watch: true, // Set watch to true to continuously track the user's location

          enableHighAccuracy: true,

          maximumAge: 0,

        });

      }

      statusMessage.innerHTML = "Device location found";

      setTimeout(function () {

        statusMessageContainer.style.display = "none";

      }, 3000); // Adjust the duration as needed (in milliseconds)

    });

  }

  setTimeout(startLocating, 1000); // Delay starting the locating process by 1 second

});
