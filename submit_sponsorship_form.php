<?php
// Check if the form is submitted
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Get the form data
    $contactName = $_POST['contact-name'];
    $contactEmail = $_POST['contact-email'];
    $businessName = $_POST['name'];
    $address = $_POST['address'];
    $businessSummary = $_POST['business-summary'];
    $location = $_POST['location'];

    // Validate and process the form data as needed
    // ...

    // Save the form data to a text file (sponsorship_form_data.txt)
    $data = "Contact Name: $contactName\n";
    $data .= "Contact Email: $contactEmail\n";
    $data .= "Business Name: $businessName\n";
    $data .= "Address: $address\n";
    $data .= "Business Summary: $businessSummary\n";
    $data .= "Location to Sponsor: $location\n\n";

    $file = fopen('sponsorship_form_data.txt', 'a');
    fwrite($file, $data);
    fclose($file);

    // Redirect to a thank you page
    header('Location: thank_you.html');
    exit;
}
?>
