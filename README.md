# Minnesota Then: Museum Without Walls

![Minnesota Then Logo](https://mnthen.com/images/logo.webp)

## Overview

Minnesota Then is an innovative "Museum Without Walls" concept that transforms the traditional museum experience by bringing history directly to where it happened. This location-based web application allows users to explore historical sites throughout Minnesota by physically visiting locations and unlocking rich multimedia content including images, audio narration, and historical information.

## 🌟 Key Features

- **Interactive Map Interface**: Navigate through historical points of interest using an optimized Leaflet.js map
- **Location-Based Content**: Unlock historical information when physically near points of interest (within 20 feet)
- **Audio Docent**: Listen to narrated historical information about each location
- **Responsive Design**: Optimized for all devices with special attention to mobile experience
- **Advanced Geolocation**: Sophisticated position tracking with Kalman filtering and adaptive smoothing
- **Offline Capability**: Core functionality works with limited connectivity
- **Multiple Navigation Options**: Integration with Google Maps, Apple Maps, and Waze for directions

## 🧠 Technical Implementation

The application is built using modern web technologies:

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Mapping**: Leaflet.js with custom markers and clustering
- **Geolocation**: HTML5 Geolocation API with advanced filtering algorithms
- **Media**: Optimized image loading and HTML5 audio
- **Performance**: Lazy loading, resource hints, and critical CSS inlining

### Geolocation Optimization

The application implements several advanced techniques to provide accurate and smooth location tracking:

- Kalman filtering for position smoothing
- Adaptive velocity prediction
- Stationary state detection
- Jitter reduction algorithms
- Background/foreground state management
- Accuracy-based filtering

### Map Rendering

The map interface features:

- Custom marker clustering
- Optimized tile loading
- Responsive zoom levels based on movement speed
- Edge proximity detection for optimal centering
- Touch gesture optimization for mobile devices

## 📱 User Experience

The application guides users through historical locations with:

1. **Discovery**: Users navigate to historical points using the interactive map
2. **Proximity Detection**: When within 20 feet of a location, content automatically unlocks
3. **Engagement**: Users view historical images and listen to narrated information
4. **Learning**: Additional historical context is provided after the audio tour
5. **Exploration**: Users can continue to other nearby locations

## 🚀 Getting Started

To run this project locally:

1. Clone the repository
2. Open `index.html` in a modern web browser
3. Allow location permissions when prompted
4. Navigate to a test location or use the developer tools to simulate GPS coordinates

## 📂 Project Structure

```
minnesota-then/
├── css/                  # Stylesheets
│   ├── mainmap.css       # Main map styling
│   └── mnthen_main_map2.css # Additional map styling
├── images/               # Image assets
│   ├── logo.webp         # Site logo
│   └── ...               # Other images
├── js/                   # JavaScript files
│   └── locations_main.js # Location data and functionality
├── index.html            # Main entry point
└── README.md             # Project documentation
```

## 🔧 Core Components

The main application file contains several key components:

1. **Map Initialization**: Sets up the Leaflet map with optimized settings
2. **Geolocation Handling**: Manages user position tracking and updates
3. **Location Hunt**: Displays content when users are near points of interest
4. **Audio Player**: Controls for audio playback of historical narration
5. **UI Components**: Modals, popups, and interactive elements
6. **Event Listeners**: Handles user interactions and device events

## 🔮 Future Enhancements

- Augmented reality views of historical sites
- User contributions and community stories
- Gamification elements like badges and challenges
- Integration with museum collections API
- Offline content caching for areas with poor connectivity

## 📄 License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0).

### What this means:

- You are free to use, modify, and distribute this software.
- If you distribute this software or derivative works, you must make the source code available under the same license.
- Any modifications you make must be released under the same license if distributed.
- No warranty is provided with this software.

For the full license text, see [the GNU GPL v3 License](https://www.gnu.org/licenses/gpl-3.0.en.html).

## 🙏 Acknowledgements

- Minnesota Historical Society for historical data and photographs
- Metropolitan State University for research methodology
- OpenStreetMap for map data and tiles
- Leaflet.js for mapping functionality
- All contributors, researchers, and testers who made this project possible

## 📞 Contact

For questions or feedback, please contact: mattreicher@protonmail.com
