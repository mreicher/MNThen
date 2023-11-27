// questions.js

const questions = [
{
  question: "Who was the first keeper of John O'Connor's layover agreement system?",
  answers: ["John Dillinger", "William 'Reddy' Griffin", "'Dapper' Dan Hogan", "Alvin Karpis"],
  correctAnswer: "William 'Reddy' Griffin",
  tidbit: "After arriving in town and meeting with the police, criminals stopped to 'check in' with Griffin at the Hotel Savoy in downtown St. Paul. Among his many duties, Griffin collected bribes and brought the money to O'Connor."
},
  {
  question: "What earned Dan Hogan the nickname 'Dapper'?",
  answers: [
    "His leadership skills",
    "His stylish dress",
    "His role as underworld ambassador",
    "His political acumen"
  ],
  correctAnswer: "His stylish dress",
  tidbit: "Dan Hogan, affectionately known as 'Dapper' due to his stylish dress, wasn't just a prominent figure in St. Paul's underworld; he was a key liaison between local law enforcement and the criminal elements within the city."
},
  {
  question: "What prompted Roy McCord to search for 'peeping toms' on the night of January 13, 1934?",
  answers: [
    "A concerned call from his wife",
    "A request from his co-worker",
    "An assignment from the airport",
    "A tip from an anonymous source"
  ],
  correctAnswer: "A concerned call from his wife",
  tidbit: "Concerned about strange activity, McCord’s wife had called his work and asked him to help look for potential 'peeping toms.' When his shift ended, McCord enlisted co-worker Robert Luening and met up with Cowin at his 562 Holly Ave. apartment."
},
  {
  question: "What prompted the Barker-Karpis Gang to turn to high-profile kidnapping in the aftermath of the 21st Amendment?",
  answers: [
    "The success of the Hamm Jr. kidnapping",
    "To replace income from illegal alcohol trade",
    "A tip from an anonymous source",
    "A recommendation from Harry Sawyer"
  ],
  correctAnswer: "To replace income from illegal alcohol trade",
  tidbit: "The December 1933 ratification of the 21st Amendment dried up the illegal alcohol trade, ending an income source for the criminal underworld that needed to be replaced. Hoping to make large amounts of money quickly without the risks associated with robbing banks, the Barker-Karpis Gang turned to high-profile kidnapping."
},
  {
    question: "Which river runs through the Twin Cities of Minneapolis and St. Paul?",
    answers: ["Mississippi River", "Missouri River", "Red River", "Ohio River"],
    correctAnswer: "Mississippi River",
          tidbit: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat."
  },
  // Add more questions here following the same format
];

// Export the questions for use in the HTML file
if (typeof module !== 'undefined' && module.exports) {
  module.exports = questions;
}
