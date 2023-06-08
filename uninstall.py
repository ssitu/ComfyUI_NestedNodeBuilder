import os
from directory_paths import js_extensions_repo_path, repo_name

print(f"Uninstalling extra files installed by {repo_name}...")

# Remove files from the extensions folder
for file_name in os.listdir(js_extensions_repo_path):
    if file_name.endswith(".js"):
        file_path = os.path.join(js_extensions_repo_path, file_name)
        os.remove(file_path)

# Remove the extensions folder
os.rmdir(js_extensions_repo_path)

print(f"You can now delete the {repo_name} folder in ComfyUI/custom_nodes/")
