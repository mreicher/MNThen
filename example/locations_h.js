const locations_h = [
    {
        name: "Stone Arch Bridge",
        city: "Minneapolis",
        lat: 45.14434783374931,
        lng: -93.00441148466629,
        images: [
            "https://www.mnthen.com/images/fire_1893.jpg",
            "https://example.com/stone-arch-bridge-2.jpg",
            "https://example.com/stone-arch-bridge-3.jpg"
        ],
        imageSource: "Minnesota Historical Society",
        audio: "https://www.mnthen.com/audio/rath.mp3",
        creator: "John Doe",
        trivia: {
            question: "In what year was the Stone Arch Bridge completed?",
            options: ["1883", "1890", "1901", "1920"],
            answer: 0
        }
    },
    {
        name: "Split Rock Lighthouse",
        city: "Two Harbors",
        lat: 45.144664056565475,
        lng: -93.0030220919916,
        images: [
            "https://www.mnthen.com/images/fire_1893.jpg",
            "https://example.com/split-rock-lighthouse-2.jpg",
            "https://example.com/split-rock-lighthouse-3.jpg"
        ],
        imageSource: "Minnesota Department of Natural Resources",
        audio: "https://www.mnthen.com/audio/rath.mp3",
        creator: "Jane Smith",
        trivia: {
            question: "What year did Split Rock Lighthouse first shine its light?",
            options: ["1905", "1910", "1915", "1920"],
            answer: 2
        }
    },
    {
        name: "Minnehaha Falls",
        city: "Minneapolis",
        lat: 44.9153,
        lng: -93.2109,
        images: [
            "https://www.mnthen.com/images/fire_1893.jpg",
            "https://example.com/minnehaha-falls-2.jpg",
            "https://example.com/minnehaha-falls-3.jpg"
        ],
        imageSource: "Minneapolis Park & Recreation Board",
        audio: "https://example.com/minnehaha-falls-audio.mp3",
        creator: "Alex Johnson",
        trivia: {
            question: "How tall is Minnehaha Falls?",
            options: ["33 feet", "53 feet", "73 feet", "93 feet"],
            answer: 1
        }
    },
    {
        name: "Mall of America",
        city: "Bloomington",
        lat: 44.8548,
        lng: -93.2422,
        images: [
           "https://www.mnthen.com/images/fire_1893.jpg",
            "https://example.com/mall-of-america-2.jpg",
            "https://example.com/mall-of-america-3.jpg"
        ],
        imageSource: "Mall of America Official Website",
        audio: "https://example.com/mall-of-america-audio.mp3",
        creator: "Sarah Lee",
        trivia: {
            question: "In what year did the Mall of America open?",
            options: ["1982", "1992", "2002", "2012"],
            answer: 1
        }
    },
    {
        name: "Itasca State Park",
        city: "Park Rapids",
        lat: 47.2372,
        lng: -95.2009,
        images: [
            "https://www.mnthen.com/images/fire_1893.jpg",
            "https://example.com/itasca-state-park-2.jpg",
            "https://example.com/itasca-state-park-3.jpg"
        ],
        imageSource: "Minnesota State Parks",
        audio: "https://example.com/itasca-state-park-audio.mp3",
        creator: "Mike Wilson",
        trivia: {
            question: "Which famous river begins its journey at Itasca State Park?",
            options: ["Mississippi River", "Missouri River", "Ohio River", "Colorado River"],
            answer: 0
        }
    },
    {
        name: "Glensheen Mansion",
        city: "Duluth",
        lat: 46.8173,
        lng: -92.0574,
        images: [
            "https://www.mnthen.com/images/fire_1893.jpg",
            "https://example.com/glensheen-mansion-2.jpg",
            "https://example.com/glensheen-mansion-3.jpg"
        ],
        imageSource: "University of Minnesota Duluth",
        audio: "https://example.com/glensheen-mansion-audio.mp3",
        creator: "Emily Brown",
        trivia: {
            question: "In what year was the construction of Glensheen Mansion completed?",
            options: ["1898", "1908", "1918", "1928"],
            answer: 1
        }
    },
    {
        name: "Boundary Waters Canoe Area Wilderness",
        city: "Ely",
        lat: 47.9475,
        lng: -91.8151,
        images: [
            "https://www.mnthen.com/images/fire_1893.jpg",
            "https://example.com/boundary-waters-2.jpg",
            "https://example.com/boundary-waters-3.jpg"
        ],
        imageSource: "U.S. Forest Service",
        audio: "https://example.com/boundary-waters-audio.mp3",
        creator: "Tom Anderson",
        trivia: {
            question: "How many lakes are in the Boundary Waters Canoe Area Wilderness?",
            options: ["About 500", "About 1,000", "About 1,500", "About 2,000"],
            answer: 1
        }
    },
    {
        name: "Jeffers Petroglyphs",
        city: "Comfrey",
        lat: 44.0683,
        lng: -95.0178,
        images: [
           "https://www.mnthen.com/images/fire_1893.jpg",
            "https://example.com/jeffers-petroglyphs-2.jpg",
            "https://example.com/jeffers-petroglyphs-3.jpg"
        ],
        imageSource: "Minnesota Historical Society",
        audio: "https://example.com/jeffers-petroglyphs-audio.mp3",
        creator: "Lisa Garcia",
        trivia: {
            question: "How old are some of the oldest petroglyphs at Jeffers?",
            options: ["1,000 years", "3,000 years", "5,000 years", "7,000 years"],
            answer: 3
        }
    },
    {
        name: "Soudan Underground Mine",
        city: "Soudan",
        lat: 47.8233,
        lng: -92.2419,
        images: [
            "https://www.mnthen.com/images/fire_1893.jpg",
            "https://example.com/soudan-mine-2.jpg",
            "https://example.com/soudan-mine-3.jpg"
        ],
        imageSource: "Minnesota Department of Natural Resources",
        audio: "https://example.com/soudan-mine-audio.mp3",
        creator: "David Chen",
        trivia: {
            question: "How deep is the Soudan Underground Mine?",
            options: ["1/2 mile", "3/4 mile", "1 mile", "1 1/4 miles"],
            answer: 1
        }
    },
    {
        name: "Fort Snelling",
        city: "St. Paul",
        lat: 44.8936,
        lng: -93.1823,
        images: [
            "https://www.mnthen.com/images/fire_1893.jpg",
            "https://example.com/fort-snelling-2.jpg",
            "https://example.com/fort-snelling-3.jpg"
        ],
        imageSource: "Minnesota Historical Society",
        audio: "https://example.com/fort-snelling-audio.mp3",
        creator: "Rachel Taylor",
        trivia: {
            question: "In what year was Fort Snelling built?",
            options: ["1799", "1809", "1819", "1829"],
            answer: 2
        }
    }
];
