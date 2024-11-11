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

We love your input! We want to make contributing to this project as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

### We Develop with Github
We use github to host code, to track issues and feature requests, as well as accept pull requests.

### We Use [Github Flow](https://guides.github.com/introduction/flow/index.html), So All Code Changes Happen Through Pull Requests
Pull requests are the best way to propose changes to the codebase. We actively welcome your pull requests:

1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. If you've changed APIs, update the documentation.
4. Ensure the test suite passes.
5. Make sure your code lints.
6. Issue that pull request!

### Any contributions you make will be under the GPL v3 Software License
In short, when you submit code changes, your submissions are understood to be under the same [GPL v3 License](https://www.gnu.org/licenses/gpl-3.0.en.html) that covers the project.

### Report bugs using Github's [issues](https://github.com/yourusername/minnesota-then/issues)
We use GitHub issues to track public bugs. Report a bug by [opening a new issue](https://github.com/yourusername/minnesota-then/issues/new); it's that easy!

### Write bug reports with detail, background, and sample code

**Great Bug Reports** tend to have:

- A quick summary and/or background
- Steps to reproduce
  - Be specific!
  - Give sample code if you can.
- What you expected would happen
- What actually happens
- Notes (possibly including why you think this might be happening, or stuff you tried that didn't work)

### Use a Consistent Coding Style

* 2 spaces for indentation rather than tabs
* You can try running `npm run lint` for style unification

## References
This document was adapted from the open-source contribution guidelines for [Facebook's Draft](https://github.com/facebook/draft-js/blob/master/CONTRIBUTING.md)

## License

By contributing, you agree that your contributions will be licensed under its GPL v3 License.

## Contact

For more information or support, please contact mattreicher@protonmail.com. See the project in action at [Minnesota Then](https://www.mnthen.com)
