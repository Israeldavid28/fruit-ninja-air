import os
from rembg import remove
from PIL import Image

image_dir = 'frontend_web/public/frutas'

if not os.path.exists(image_dir):
    print(f"Directory {image_dir} does not exist!")
    exit(1)

for filename in os.listdir(image_dir):
    if filename.endswith('.png'):
        input_path = os.path.join(image_dir, filename)
        
        # Read the image
        print(f"Processing {filename}...")
        try:
            with open(input_path, 'rb') as f:
                input_data = f.read()
            
            # Remove background
            output_data = remove(input_data)
            
            # Save back to the same file (overwrite)
            with open(input_path, 'wb') as f:
                f.write(output_data)
            print(f"Successfully processed {filename}")
        except Exception as e:
            print(f"Failed to process {filename}: {e}")

print("Background removal complete for all images.")
