# Minnesota Then | Museum Without Walls

## Description

Minnesota Then is an interactive, location-based web application that serves as a "Museum Without Walls". It allows users to explore historical locations throughout Minnesota using a map interface, providing audio tours, images, and additional information about each site.

## Features

- Interactive map interface using Leaflet.js
- Geolocation-based user tracking
- Custom location markers with popup information
- Audio player for location-specific content
- Responsive design for mobile and desktop use
- Navigation assistance to historical sites
- Summary information for each location
- Multiple navigation app options (Google Maps, Waze, Apple Maps)

## Technical Details

- Built with HTML5, CSS3, and JavaScript
- Uses Leaflet.js for map functionality
- Implements the Geolocation API for user positioning
- Utilizes Bootstrap for responsive design elements
- Custom audio player implementation
- Marker clustering for improved map performance

## Setup and Usage

1. Clone the repository to your local machine.
2. Ensure you have a web server set up to serve the files (e.g., Apache, Nginx, or a simple Python HTTP server).
3. Update the `locations_test.js` file with your specific location data.
4. Customize the styling in `mainmap.css` as needed.
5. Deploy the application to your web server.

## Key Components

- `index.html`: Main entry point of the application
- `locations_test.js`: Contains data for all historical locations
- `mainmap.css`: Custom styles for the application
- JavaScript functions within `index.html`:
  - `initMap()`: Initializes the Leaflet map
  - `updateUserLocation()`: Handles user location updates
  - `showLocationHunt()`: Displays information when near a historical site
  - `loadAllLocations()`: Populates the map with location markers

## Future Improvements

- Implement offline functionality for better performance in areas with poor connectivity
- Add user accounts for saving favorite locations and tracking visited sites
- Integrate more multimedia content such as videos or AR experiences
- Develop a backend API for easier content management and updates

## Contributing

We welcome contributions to improve Minnesota Then. Please submit pull requests or open issues to suggest enhancements or report bugs.

## License

GPL v3

## Contact

For more information or support, please contact mattreicher@protonmail.com
