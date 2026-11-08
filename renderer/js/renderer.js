const form = document.querySelector('#img-form');
const outputPath = document.querySelector('#output-path');
const filename = document.querySelector('#filename');
const heightInput = document.querySelector('#height');
const widthInput = document.querySelector('#width');
const scanWifi = document.querySelector('#scanWifi');
const chooseImageButton = document.querySelector('#chooseImage');

function scanWifiNetworks() {
  console.log('scan wifi networks');
  api.scanWifi();
}


// Choose image (dialog opened by the main process) and show form
async function loadImage() {
  let image;
  try {
    image = await api.chooseImage();
  } catch (err) {
    alertError('Image selection failed');
    return;
  }
  if (!image) return;

  // Show form, image name and output path
  form.style.display = 'block';
  filename.textContent = image.name;
  outputPath.innerText = path.join(os.homedir(), 'imageresizer');
}

// Resize image (the main process validates the dimensions)
function resizeImage(e) {
  e.preventDefault();

  if (widthInput.value === '' || heightInput.value === '') {
    alertError('Please enter a width and height');
    return;
  }

  api.resizeImage({
    height: heightInput.value,
    width: widthInput.value,
  });
}

// When done, show the size actually produced by the main process (#9)
api.onImageDone(({ width, height }) =>
  alertSuccess(`Image resized to ${width} x ${height}`)
);

const IMAGE_ERRORS = {
  'too-large': 'Image too large',
  unsupported: 'Unsupported image format',
};
api.onImageError(({ reason }) => alertError(IMAGE_ERRORS[reason] || 'Resize failed'));

function alertSuccess(message) {
  Toastify.toast({
    text: message,
    duration: 5000,
    close: false,
    style: {
      background: 'green',
      color: 'white',
      textAlign: 'center',
    },
  });
}

function alertError(message) {
  Toastify.toast({
    text: message,
    duration: 5000,
    close: false,
    style: {
      background: 'red',
      color: 'white',
      textAlign: 'center',
    },
  });
}

// Image choice listener
chooseImageButton.addEventListener('click', loadImage);
// Form submit listener
form.addEventListener('submit', resizeImage);
// Scan wifi listener
scanWifi.addEventListener('click', scanWifiNetworks);

