import os
import folder_paths

comfy_path = os.path.dirname(folder_paths.__file__)
ext_path = os.path.dirname(os.path.realpath(__file__))
repo_name = os.path.basename(ext_path)
default_nested_nodes_path = os.path.join(ext_path, "nested_nodes")
js_extensions_path = os.path.join(comfy_path, "web", "extensions")
config_path = os.path.join(ext_path, "config.yaml")
js_extensions_repo_path = os.path.join(js_extensions_path, repo_name)