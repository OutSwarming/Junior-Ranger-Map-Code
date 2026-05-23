import pandas as pd
from geopy.geocoders import Nominatim
import time
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Initialize Geocoder
geolocator = Nominatim(user_agent="JuniorRanger_Final_Build")

def get_coords(name, state):
    """6-Step Super-Scrubber Logic"""
    steps = [
        f"{name}, {state}, USA", # Step 1: Full
        f"{name}, USA",          # Step 2: Broad
        " ".join(str(name).split()[:3]) + f", {state}, USA", # Step 3: First 3 words
        " ".join(str(name).split()[:2]) + f", {state}, USA", # Step 4: First 2 words
        str(name).split()[0] + f", {state}, USA",            # Step 5: First word + State
        f"{state}, USA"          # Step 6: Center of State (Last Resort)
    ]
    
    for i, query in enumerate(steps, 1):
        try:
            # Clean common 'noise' words for fallback steps
            if i > 2:
                query = query.replace("Visitor Center", "").replace("VC", "").replace("Nature Center", "")
            
            location = geolocator.geocode(query, timeout=10)
            if location:
                print(f"  [STEP {i} SUCCESS] -> {query}")
                return location.latitude, location.longitude
        except:
            continue
        time.sleep(1.2) # Safety delay for API limits
    
    return None, None

def main():
    input_file = REPO_ROOT / '01-code' / 'app' / 'assets' / 'data' / 'jr-fallback.csv'
    output_file = REPO_ROOT / '02-data' / 'data' / 'JR_Final_Map_Data.csv'
    
    if not os.path.exists(input_file):
        print(f"Error: {input_file} not found!")
        return

    df = pd.read_csv(input_file)
    
    name_col = 'siteName' if 'siteName' in df.columns else 'Location'
    state_col = 'state' if 'state' in df.columns else 'State'
    lat_col = 'latitude' if 'latitude' in df.columns else 'Lat'
    lng_col = 'longitude' if 'longitude' in df.columns else 'Lng'

    if lat_col not in df.columns:
        df[lat_col] = None
    if lng_col not in df.columns:
        df[lng_col] = None

    print(f"Starting geocoding for {len(df)} rows. This will take ~10 minutes.")

    for index, row in df.iterrows():
        # Skip if already geocoded
        if pd.notnull(row[lat_col]) and pd.notnull(row[lng_col]):
            continue
            
        print(f"[{index+1}/{len(df)}] Processing: {row[name_col]}...")
        lat, lng = get_coords(row[name_col], row[state_col])
        
        df.at[index, lat_col] = lat
        df.at[index, lng_col] = lng
        
        # Save progress every 10 rows in case of a crash
        if index % 10 == 0:
            df.to_csv(output_file, index=False)

    df.to_csv(output_file, index=False)
    print(f"\nDONE! Final file saved as: {output_file}")

if __name__ == "__main__":
    main()
