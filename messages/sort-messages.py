import os
import json

def sort_json(data):
    if isinstance(data, dict):
        return {k: sort_json(v) for k, v in sorted(data.items())}
    elif isinstance(data, list):
        return [sort_json(item) for item in data]
    else:
        return data

def sort_json_files(directory):
    for filename in os.listdir(directory):
        if filename.endswith('.json'):
            filepath = os.path.join(directory, filename)
            with open(filepath, 'r', encoding='utf-8') as file:
                data = json.load(file)
            
            sorted_data = sort_json(data)
            
            with open(filepath, 'w', encoding='utf-8') as file:
                json.dump(sorted_data, file, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    directory = '.'
    sort_json_files(directory)