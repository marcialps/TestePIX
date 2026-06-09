<?php
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !isset($_FILES['logo'])) {
    echo json_encode(["error" => "Nenhum arquivo enviado."]);
    exit;
}

$upload = $_FILES['logo'];
$allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
$maxSize = 5 * 1024 * 1024; // 5 MB

if ($upload['error'] !== UPLOAD_ERR_OK) {
    echo json_encode(["error" => "Erro no envio do arquivo ({$upload['error']})."]);
    exit;
}

if ($upload['size'] > $maxSize) {
    echo json_encode(["error" => "O arquivo é muito grande. Máximo 5MB."]);
    exit;
}

$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mimeType = finfo_file($finfo, $upload['tmp_name']);
finfo_close($finfo);

if (!in_array($mimeType, $allowedTypes, true)) {
    echo json_encode(["error" => "Tipo de arquivo inválido. Envie PNG, JPG ou WEBP."]);
    exit;
}

$targetDir = __DIR__ . DIRECTORY_SEPARATOR . 'img' . DIRECTORY_SEPARATOR;
if (!file_exists($targetDir)) {
    mkdir($targetDir, 0777, true);
}

$fileExtension = strtolower(pathinfo($upload['name'], PATHINFO_EXTENSION));
$fileExtension = preg_replace('/[^a-z0-9]/', '', $fileExtension);
if (!$fileExtension) {
    $fileExtension = 'png';
}

$fileName = 'logo_' . time() . '.' . $fileExtension;
$targetFile = $targetDir . $fileName;
$publicUrl = 'img/' . $fileName;

if (!move_uploaded_file($upload['tmp_name'], $targetFile)) {
    echo json_encode(["error" => "Falha ao salvar a imagem no servidor."]);
    exit;
}

echo json_encode(["url" => $publicUrl]);
exit;
?>
