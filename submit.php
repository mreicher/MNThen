<?php
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $name = $_POST['name'];
  $email = $_POST['email'];
  $message = $_POST['message'];

  // Format the data
  $formattedData = "Name: $name\nEmail: $email\nMessage: $message\n\n";

  // Specify the file path
  $filePath = 'form_submissions.txt';

  // Open the file in append mode
  $file = fopen($filePath, 'a');

  if ($file) {
    // Write the data to the file
    fwrite($file, $formattedData);

    // Close the file
    fclose($file);

    // Redirect back to the contact page with success message
    header('Location: contact.html?success=true');
    exit;
  } else {
    // Redirect back to the contact page with error message
    header('Location: contact.html?success=false');
    exit;
  }
}
?>
