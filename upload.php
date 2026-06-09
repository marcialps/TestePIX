<?php
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['logo'])) {
    $targetDir = "img/";
    if (!file_exists($targetDir)) {
        mkdir($targetDir, 0777, true);
    }
    
    // Gerar um nome único para evitar cache
    $fileExtension = pathinfo($_FILES["logo"]["name"], PATHINFO_EXTENSION);
    $fileName = "logo_" . time() . "." . $fileExtension;
    $targetFile = $targetDir . $fileName;

    if (move_uploaded_file($_FILES["logo"]["tmp_name"], $targetFile)) {
        echo json_encode(["url" => $targetFile]);
        exit;
    }
}

echo json_encode(["error" => "Falha no upload"]);
?>
