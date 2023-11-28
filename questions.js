const questions = [
  {
    question: "Who was the first keeper of John O'Connor's layover agreement system?",
    answers: ["John Dillinger", "William Griffin", "'Dapper' Dan Hogan", "Alvin Karpis"],
    correctAnswer: "William Griffin",
    tidbit: "After arriving in town and meeting with the police, criminals stopped to 'check in' with Griffin at the Hotel Savoy in downtown St. Paul. Griffin collected bribes and brought the money to O'Connor."
  },
  {
    question: "What earned Dan Hogan the nickname 'Dapper'?",
    answers: [
      "Leadership skills",
      "Stylish dress",
      "Ambassador role",
      "Political acumen"
    ],
    correctAnswer: "Stylish dress",
    tidbit: "Dan Hogan, known as 'Dapper' due to his stylish dress, was a key liaison between local law enforcement and criminal elements in St. Paul."
  },
  {
    question: "What was the reason for Roy McCord's search on January 13, 1934?",
    answers: [
      "His wife called",
      "Co-worker request",
      "Work assignment",
      "Anonymous tip"
    ],
    correctAnswer: "His wife called",
    tidbit: "McCord's wife called, concerned about strange activity. He enlisted co-worker Robert Luening and met up with Cowin at his 562 Holly Ave. apartment."
  },
  {
    question: "Why did the Barker-Karpis Gang turn to kidnapping post-21st Amendment?",
    answers: ["Hamm Jr. success", "Replace alcohol income", "Anonymous tip", "Harry Sawyer's idea"],
    correctAnswer: "Replace alcohol income",
    tidbit: "The 21st Amendment ended illegal alcohol trade, leading the Barker-Karpis Gang to resort to kidnapping for income."
  },
    {
    question: "Who was Oscar Erickson, and what was his job on December 16, 1932?",
    answers: ["Cook", "Wreath salesman", "Florist", "Banker"],
    correctAnswer: "Wreath salesman",
    tidbit: "Oscar Erickson was a Christmas wreath salesman on December 16, 1932."
  },
  // Add more questions here following the same format
];

// Export the questions for use in the HTML file
if (typeof module !== 'undefined' && module.exports) {
  module.exports = questions;
}
