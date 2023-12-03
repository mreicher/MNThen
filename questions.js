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
    question: "What was the reason behind Roy McCord's search on January 13, 1934?",
    answers: [
      "A phone call from his wife",
      "Request from his co-worker",
      "Assignment from the airport",
      "Anonymous tip"
    ],
    correctAnswer: "A phone call from his wife",
    tidbit: "McCord's wife called, concerned about strange activity. He enlisted co-worker Robert Luening and met up with Cowin at his 562 Holly Ave. apartment."
  },
  {
    question: "Why did the Barker-Karpis Gang turn to kidnapping post-21st Amendment?",
    answers: ["Hamm Jr. kidnapping success", "Replace illegal alcohol income", "An anonymous tip", "Harry Sawyer's recommendation"],
    correctAnswer: "Replace illegal alcohol income",
    tidbit: "The 21st Amendment ended illegal alcohol trade, leading the Barker-Karpis Gang to resort to kidnapping for income."
  },
  {
  question: "What controversial aspect surrounded Homer Van Meter's death?",
  answers: [
    "Excessive police force",
    "Lack of eyewitnesses",
    "Escape before shooting",
    "Involvement of a rival gang"
  ],
  correctAnswer: "Excessive police force",
  tidbit: "Homer Van Meter's death was marked by controversy due to the excessive force used by the police, with reports suggesting he was shot multiple times even after falling to the ground."
},
{
  question: "What led to the gunfight at Lincoln Court Apartments involving John Dillinger?",
  answers: [
    "A bank robbery",
    "A turf dispute",
    "A routine check by law enforcement",
    "An anonymous tip"
  ],
  correctAnswer: "A routine check by law enforcement",
  tidbit: "The gunfight at Lincoln Court Apartments, involving John Dillinger, escalated from a routine check by law enforcement, sparked by the suspicions of the building's owner about the residents of apartment 303."
},
    {
    question: "Who was Oscar Erickson, and what was his job on December 16, 1932?",
    answers: ["Cook", "Christmas wreath salesman", "Florist", "Banker"],
    correctAnswer: "Christmas wreath salesman",
    tidbit: "Oscar Erickson was a Christmas wreath salesman on December 16, 1932."
  },
{
  question: "What significant action did William Hamm Jr. have to perform while being held by the kidnappers?",
  answers: [
    "Signing the ransom notes",
    "Identifying his abductors",
    "Recording a plea for help",
    "Planning his own escape"
  ],
  correctAnswer: "Signing the ransom notes",
  tidbit: "While kidnapped, William Hamm Jr. was forced by the Barker-Karpis Gang to sign four notes authorizing a large ransom payment, a critical part of their abduction strategy."
}

  // Add more questions here following the same format
];

// Export the questions for use in the HTML file
if (typeof module !== 'undefined' && module.exports) {
  module.exports = questions;
}
