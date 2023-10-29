// questions.js

const questions = [
  {
    question: "What year was Minnesota admitted to the Union?",
    answers: ["1858", "1820", "1889", "1900"],
    correctAnswer: "1858",
        tidbit: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat."
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
