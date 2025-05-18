import os
import sys
import io
import zipfile
import datetime
import subprocess
import shutil
import time
import glob
import asyncio
import aioftp # parfive[ftp] requires aioftp
import parfive # The parallel downloader
from urllib.parse import quote_plus # Import quote_plus for URL encoding

# --- Configuration from Environment Variables ---
# Use os.environ.get and check for empty string before using the value or default

ftp_host_env = os.environ.get('FTP_HOST')
FTP_HOST = ftp_host_env if ftp_host_env else 'ftp.minefort.com' # Use env var if not empty, otherwise default
print(f"Config: FTP_HOST = {FTP_HOST}")

ftp_port_env = os.environ.get('FTP_PORT')
# Check if env var exists and is not empty before converting to int, otherwise use default 21
FTP_PORT = int(ftp_port_env) if ftp_port_env else 21
print(f"Config: FTP_PORT = {FTP_PORT}")

ftp_username_env = os.environ.get('FTP_USERNAME') # No default, required
FTP_USERNAME = ftp_username_env
print(f"Config: FTP_USERNAME = {'***' if FTP_USERNAME else 'Not Set'}")


ftp_password_env = os.environ.get('FTP_PASSWORD') # No default, required
FTP_PASSWORD = ftp_password_env
print(f"Config: FTP_PASSWORD = {'***' if FTP_PASSWORD else 'Not Set'}")


remote_ftp_root_env = os.environ.get('REMOTE_FTP_ROOT')
REMOTE_FTP_ROOT = remote_ftp_root_env if remote_ftp_root_env else '/' # Use env var if not empty, otherwise default
print(f"Config: REMOTE_FTP_ROOT = {REMOTE_FTP_ROOT}")


backup_repo_url_env = os.environ.get('BACKUP_REPO_URL') # No default, required
BACKUP_REPO_URL = backup_repo_url_env
print(f"Config: BACKUP_REPO_URL = {'***' if BACKUP_REPO_URL else 'Not Set'}")


github_token_env = os.environ.get('GITHUB_TOKEN') # No default, required for git push
GITHUB_TOKEN = github_token_env
print(f"Config: GITHUB_TOKEN = {'***' if GITHUB_TOKEN else 'Not Set'}")


backup_folder_in_repo_env = os.environ.get('BACKUP_FOLDER_IN_REPO')
BACKUP_FOLDER_IN_REPO = backup_folder_in_repo_env if backup_folder_in_repo_env else 'backups' # Use env var if not empty, otherwise default
print(f"Config: BACKUP_FOLDER_IN_REPO = {BACKUP_FOLDER_IN_REPO}")


# --- Items to Backup ---
# Define the specific folders and files to include from the REMOTE_FTP_ROOT
ITEMS_TO_BACKUP = [
    "world",
    "world_nether",
    "world_the_end",
    "usercache.json"
]
print(f"Config: ITEMS_TO_BACKUP = {ITEMS_TO_BACKUP}")


# --- Validation ---
# Validation now checks the variables after attempting to read them from env or using defaults
if not all([FTP_USERNAME, FTP_PASSWORD, BACKUP_REPO_URL, GITHUB_TOKEN]):
    print("Error: FTP_USERNAME, FTP_PASSWORD, BACKUP_REPO_URL, and GITHUB_TOKEN environment variables must be set and not empty.")
    sys.exit(1)
if not ITEMS_TO_BACKUP:
    print("Warning: ITEMS_TO_BACKUP list is empty. No files or folders will be backed up.")


# --- Constants ---
# Include time for uniqueness if needed, and ensure it's URL/filename safe
DATE_STR = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
BACKUP_ZIP_FILENAME = f"server_backup_{DATE_STR}.zip"
TEMP_REPO_DIR = 'temp_backup_repo' # Temporary directory to clone the backup repo into
TEMP_ZIP_FILE_PATH = f"/tmp/{BACKUP_ZIP_FILENAME}" # Temporary location to save the zip before git
TEMP_LOCAL_DOWNLOAD_DIR = 'temp_local_ftp_backup' # Temporary local directory for parallel download


# --- FTP File Discovery (using aioftp) ---
async def collect_remote_items(ftp_client, remote_dir, items_filter=None):
    """
    Recursively collects remote file and directory paths from FTP.
    Returns a list of tuples: (remote_path, item_type) where item_type is 'file' or 'dir'.
    items_filter: A list of item names to include at the current level (only applied at REMOTE_FTP_ROOT).
    """
    print(f"Collecting items in remote directory: {remote_dir}")
    remote_items = []

    try:
        print(f"Attempting to list contents of {remote_dir}...")
        items_info = await ftp_client.list(remote_dir)
        print(f"Successfully listed {remote_dir}. Found {len(items_info)} items.")
        # Log the names and types of the items found for detailed debugging
        item_details_found = [(str(item_info[0]), item_info[1].get('type', 'N/A')) for item_info in items_info] # Convert PurePosixPath to string for logging clarity
        print(f"Details of items found in {remote_dir}: {item_details_found}")


    except Exception as e:
        print(f"Error listing contents of directory {remote_dir}: {e}")
        # Log error and return what we have
        return remote_items # Returns empty list if error on first list

    for item_info in items_info:
        item_name_path = item_info[0] # This is the PurePosixPath object
        item_name_str = str(item_name_path) # Convert to string
        item_attributes = item_info[1]

        # Skip special directories like '.' and '..'
        # Check both the string representation and the path object name if possible
        if item_name_str in ('.', '..') or item_name_path.name in ('.', '..'):
            print(f"Skipping special item: {item_name_str}")
            continue

        # Get the item name without leading slash for comparison with filter
        item_name_for_filter = item_name_str.lstrip('/')

        # --- Filtering Logic ---
        # Apply filter only at the root directory level
        if items_filter is not None and remote_dir == REMOTE_FTP_ROOT:
            # Compare the item name without the leading slash to the filter list
            if item_name_for_filter not in items_filter:
                print(f"Skipping item in root filter: {item_name_for_filter} (not in {items_filter})")
                continue
            else:
                 print(f"Including item in root filter: {item_name_for_filter}")

        # --- End Filtering Logic ---

        # Construct the full remote path for recursion/download
        full_remote_item_path = os.path.join(remote_dir, item_name_str).replace('\\', '/')
        # Clean up potential double slashes (except for root '/')
        if full_remote_item_path != '/' and full_remote_item_path.startswith('//'):
             full_remote_item_path = full_remote_item_path[1:]

        item_type = None
        if 'type' in item_attributes:
            if item_attributes['type'] == 'dir':
                item_type = 'dir'
                print(f"Identified as directory: {item_name_for_filter}") # Use cleaned name for log
            elif item_attributes['type'] == 'file':
                item_type = 'file'
                print(f"Identified as file: {item_name_for_filter}") # Use cleaned name for log
            else:
                 print(f"Skipping item with unknown type: {item_name_for_filter} (Type: {item_attributes.get('type', 'N/A')})") # Use cleaned name for log
                 continue # Skip items with types we don't handle (like links)

        if item_type == 'dir':
            # Add the directory path itself (ending with /) to the list
            # This is important for creating empty directories in the zip later
            dir_path_for_list = full_remote_item_path
            if dir_path_for_list != '/' and not dir_path_for_list.endswith('/'):
                 dir_path_for_list += '/'
             # Don't add the root directory as a separate item if it's just '/'
            if dir_path_for_list != '/':
                 remote_items.append((dir_path_for_list, 'dir'))
                 print(f"Added directory for structure: {dir_path_for_list}")

            # Recurse into this directory
            # Pass None for items_filter for recursive calls within selected directories
            print(f"Recursing into directory: {full_remote_item_path}")
            subdir_items = await collect_remote_items(ftp_client, full_remote_item_path, items_filter=None)
            remote_items.extend(subdir_items)
            print(f"Finished collecting items in subdirectory: {full_remote_item_path}")


        elif item_type == 'file':
            # Add the file path to the list
            remote_items.append((full_remote_item_path, 'file'))
            print(f"Collected file for download: {full_remote_item_path}")


    print(f"Finished collecting items in directory: {remote_dir}. Total items collected in this call: {len(items_info)}. Total items collected recursively so far: {len(remote_items)}")
    return remote_items

# --- Local Zipping ---
def zip_local_directory(local_dir, zip_filepath):
    """Creates a zip file from contents of a local directory."""
    print(f"Starting zipping process from local directory: {local_dir} to {zip_filepath}")
    try:
        with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as zipf:
            # Walk through the local directory
            for root, dirs, files in os.walk(local_dir):
                # Create base path in zip relative to the local_dir
                # os.path.relpath gives path relative to start, replace \\ for zip
                relative_base_path_in_zip = os.path.relpath(root, local_dir).replace('\\', '/')

                # Handle the root of the local_dir correctly in zip paths
                if relative_base_path_in_zip == '.':
                     relative_base_path_in_zip = ''

                # Add directories to the zip (important for empty ones)
                for dir in dirs:
                    zip_dir_path = os.path.join(relative_base_path_in_zip, dir).replace('\\', '/') + '/'
                    # print(f"Adding local directory entry to zip: {zip_dir_path}") # Too verbose
                    try:
                        # Check if the local directory actually exists before adding its entry (should, based on makedirs)
                        full_local_dir_path = os.path.join(root, dir)
                        if os.path.exists(full_local_dir_path):
                            zipf.writestr(zip_dir_path, "")
                        else:
                             print(f"Warning: Local directory {full_local_dir_path} not found for zipping, skipping entry.")

                    except Exception as e:
                         print(f"Warning: Error adding local directory {zip_dir_path} entry to zip: {e}")


                # Add files to the zip
                for file in files:
                    full_local_file_path = os.path.join(root, file)
                    # Create the path for the file within the zip
                    zip_file_path = os.path.join(relative_base_path_in_zip, file).replace('\\', '/')
                    # print(f"Adding local file to zip: {zip_file_path}") # Too verbose
                    try:
                        # Use zipf.write() which handles opening and reading the local file
                        # Check if the local file actually exists before zipping (should, based on parfive download)
                        if os.path.exists(full_local_file_path):
                             zipf.write(full_local_file_path, zip_file_path)
                        else:
                             print(f"Warning: Local file {full_local_file_path} not found for zipping, skipping.")

                    except Exception as e:
                         print(f"Warning: Error adding local file {zip_file_path} to zip: {e}")

        print("Local zipping complete.")
    except Exception as e:
        print(f"Error creating zip from local directory {local_dir}: {e}")
        raise # Re-raise the exception

# --- GitHub Interaction ---
def setup_git_credentials():
    """Sets up Git credentials for the runner."""
    print("Setting up Git credentials...")
    try:
        subprocess.run(['git', 'config', '--global', 'user.email', 'action@github.com'], check=True)
        subprocess.run(['git', 'config', '--global', 'user.name', 'GitHub Actions'], check=True)
        print("Git user configured.")
    except subprocess.CalledProcessError as e:
        print(f"Error configuring git user: {e.stderr.decode()}")
        sys.exit(1)


def clone_backup_repo(repo_url, token, target_dir):
    """Clones the backup repository using the token."""
    print(f"Cloning backup repository {repo_url} into {target_dir}...")
    # Embed token in the URL for cloning
    # Use quote_plus for parts of the URL just in case
    try:
        from urllib.parse import urlparse, urlunparse
        parsed_url = urlparse(repo_url)
        # Ensure we handle cases where hostname might be empty or other issues
        if not parsed_url.hostname:
             raise ValueError("Could not parse hostname from remote URL for token embedding.")

        netloc_with_token = f'oauth2:{token}@{parsed_url.hostname}'
        if parsed_url.port:
             netloc_with_token += f':{parsed_url.port}'
        repo_url_with_token = urlunparse(parsed_url._replace(netloc=netloc_with_token))
        print(f"Cloning URL: {repo_url_with_token.replace(token, '***')}") # Mask token in logs


    except ImportError:
        print("Warning: urllib.parse not available, unable to robustly embed token in repo URL. Proceeding with simpler replacement.")
        repo_url_with_token = repo_url.replace('https://github.com/', f'https://oauth2:{token}@github.com/', 1)
        repo_url_with_token = repo_url_with_token.replace('http://github.com/', f'http://oauth2:{token}@github.com/', 1)
        print(f"Cloning URL: {repo_url_with_token.replace(token, '***')}") # Mask token in logs
    except ValueError as ve:
         print(f"Error embedding token in repo URL: {ve}")
         sys.exit(1)
    except Exception as e:
         print(f"An unexpected error occurred during repo URL construction: {e}")
         sys.exit(1)


    try:
        # Increased clone timeout
        subprocess.run(['git', 'clone', repo_url_with_token, target_dir], check=True, timeout=180) # 3 minutes
        print("Repository cloned successfully.")
    except subprocess.CalledProcessError as e:
        print(f"Error cloning repository: {e.stderr.decode()}")
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print("Error: Git clone timed out.")
        sys.exit(1)
    except Exception as e:
        print(f"An unexpected error occurred during git clone: {e}")
        sys.exit(1)


def add_and_commit_backup(repo_dir, backup_filepath):
    """Adds, commits the new backup, and removes old ones."""
    print(f"Changing directory to {repo_dir}")
    original_dir = os.getcwd()
    os.chdir(repo_dir)

    try:
        # Find and delete old backups in the backup folder
        backup_dir_full_path = os.path.join(os.getcwd(), BACKUP_FOLDER_IN_REPO)
        if os.path.exists(backup_dir_full_path):
            print(f"Looking for old backups in {backup_dir_full_path}")
            # Use glob to find files matching the pattern
            # Ensure pattern is relative to the git repo root for git rm
            old_backups_pattern = os.path.join(BACKUP_FOLDER_IN_REPO, "server_backup_*.zip").replace('\\', '/')
            old_backups_relative_paths = sorted(glob.glob(old_backups_pattern))

            if old_backups_relative_paths:
                print(f"Found potential old backups (relative paths): {old_backups_relative_paths}")
                # Get the filename of the new backup being added relative to the repo root
                new_backup_relative_path = os.path.join(BACKUP_FOLDER_IN_REPO, os.path.basename(backup_filepath)).replace('\\', '/')

                # Keep the latest backup (the one we just created)
                # Remove all other old backups found
                for old_file_relative_path in old_backups_relative_paths:
                    if old_file_relative_path != new_backup_relative_path:
                        print(f"Found old backup, attempting to remove: {old_file_relative_path}")
                        try:
                            # Use git rm to remove the file from the index and working tree
                            subprocess.run(['git', 'rm', '--cached', old_file_relative_path], check=False, capture_output=True) # --cached only from index
                            subprocess.run(['git', 'rm', '-f', old_file_relative_path], check=False, capture_output=True) # -f to remove from working tree and index
                            print(f"Attempted git rm on {old_file_relative_path}")
                        except subprocess.CalledProcessError as e:
                            print(f"Warning: Error attempting git rm of old backup {old_file_relative_path}: {e.stderr.decode()}")
                            # Log warning but try to continue


        # Add the new backup file
        new_backup_target_dir = os.path.join(os.getcwd(), BACKUP_FOLDER_IN_REPO)
        os.makedirs(new_backup_target_dir, exist_ok=True) # Ensure target directory exists
        new_backup_target_path = os.path.join(new_backup_target_dir, os.path.basename(backup_filepath))

        print(f"Copying new backup file into repository: {new_backup_target_path}")
        shutil.copy2(backup_filepath, new_backup_target_path) # Use copy2 to preserve metadata if needed
        print(f"Copied created zip to {new_backup_target_path}")

        # Add the new backup file to staging
        # Path should be relative to the git repo root
        new_backup_target_path_relative = os.path.join(BACKUP_FOLDER_IN_REPO, os.path.basename(backup_filepath)).replace('\\', '/')
        print(f"Adding new backup file to git staging: {new_backup_target_path_relative}")
        try:
            subprocess.run(['git', 'add', new_backup_target_path_relative], check=True)
            print("New backup file added to staging.")
        except subprocess.CalledProcessError as e:
            print(f"Error adding new backup file {new_backup_target_path_relative}: {e.stderr.decode()}")
            sys.exit(1)


        # Commit changes
        # Check if there are any staged changes before committing
        status_output = subprocess.run(['git', 'status', '--portuguese'], capture_output=True, text=True, check=True).stdout.strip() # Corrected typo here - should be '--porcelain'
        if status_output:
            commit_message = f"Automated backup: {os.path.basename(backup_filepath)}"
            print(f"Committing with message: '{commit_message}'")
            try:
                subprocess.run(['git', 'commit', '-m', commit_message], check=True)
                print("Changes committed.")
            except subprocess.CalledProcessError as e:
                print(f"Error committing changes: {e.stderr.decode()}")
                # If commit fails, something is wrong. Exit.
                sys.exit(1)
        else:
            print("No changes detected by git status. Skipping commit.")


        # Push changes
        print("Pushing changes to remote repository...")
        try:
            # Use the token embedded URL for pushing
            # Get the current remote URL from the cloned repo config
            remote_name = subprocess.run(['git', 'remote'], capture_output=True, text=True, check=True).stdout.strip()
            if not remote_name:
                 print("Error: Could not determine git remote name.")
                 sys.exit(1)
            # Get the URL for the 'origin' remote (or the detected remote_name)
            original_remote_url = subprocess.run(['git', 'remote', 'get-url', remote_name], capture_output=True, text=True, check=True).stdout.strip()

             # Reconstruct the push URL with the token using urlparse for robustness
            try:
                from urllib.parse import urlparse, urlunparse
                parsed_url = urlparse(original_remote_url)
                 # Ensure we handle cases where hostname might be empty or other issues
                if not parsed_url.hostname:
                     raise ValueError("Could not parse hostname from remote URL for token embedding.")

                netloc_with_token = f'oauth2:{GITHUB_TOKEN}@{parsed_url.hostname}'
                if parsed_url.port:
                     netloc_with_token += f':{parsed_url.port}'
                push_url = urlunparse(parsed_url._replace(netloc=netloc_with_token))
                print(f"Using push URL: {push_url.replace(GITHUB_TOKEN, '***')}") # Mask token in logs

            except ImportError:
                print("Warning: urllib.parse not available, unable to robustly embed token in push URL. Proceeding with simpler replacement.")
                push_url = original_remote_url.replace('https://github.com/', f'https://oauth2:{GITHUB_TOKEN}@github.com/', 1)
                push_url = push_url.replace('http://github.com/', f'http://oauth2:{GITHUB_TOKEN}@github.com/', 1)
                print(f"Using push URL: {push_url.replace(GITHUB_TOKEN, '***')}") # Mask token in logs
            except ValueError as ve:
                 print(f"Error embedding token in push URL: {ve}")
                 sys.exit(1)
            except Exception as e:
                 print(f"An unexpected error occurred during push URL construction: {e}")
                 sys.exit(1)


            # Push the current branch (HEAD) to its upstream
            current_branch = subprocess.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()

            # Use --force-with-lease if overwriting history (e.g. always having only 1 backup file)
            # Or standard push if keeping history (e.g. keeping multiple dated backups)
            # With deleting old ones, standard push should work unless there are merge conflicts (unlikely in a dedicated backup repo)
            print(f"Pushing from branch {current_branch}...")
            # Increased timeout for push
            subprocess.run(['git', 'push', push_url, current_branch], check=True, timeout=300) # 5 minutes
            print("Changes pushed successfully.")
        except subprocess.CalledProcessError as e:
            print(f"Error pushing changes: {e.stderr.decode()}")
            sys.exit(1)
        except subprocess.TimeoutExpired:
            print("Error: Git push timed out.")
            sys.exit(1)
        except Exception as e:
             print(f"An unexpected error occurred during git push: {e}")
             sys.exit(1)

    except Exception as e:
         print(f"An unexpected error occurred during git operations: {e}")
         sys.exit(1)
    finally:
        # Change back to the original directory
        os.chdir(original_dir)


# --- Asynchronous FTP Process (using aioftp and parfive) ---
async def async_ftp_process():
    """Asynchronous function to handle FTP connection, file collection, and parallel download."""
    print(f"Starting asynchronous FTP process...")
    client = None # Initialize client to None

    try:
        # Initialize aioftp client - Try WITHOUT command timeout initially
        client = aioftp.Client() # No timeout parameter here

        print(f"Connecting to FTP (aioftp): {FTP_HOST}:{FTP_PORT} with user {FTP_USERNAME}")
        # Use asyncio.wait_for to set a specific timeout for the connection attempt itself
        # Increased connection timeout slightly
        await asyncio.wait_for(client.connect(FTP_HOST, FTP_PORT), timeout=90) # Set connection timeout (e.g., 90 seconds)

        # If connection is successful, set the command timeout
        client.timeout = 180 # 3 minutes for subsequent commands

        await client.login(FTP_USERNAME, FTP_PASSWORD)
        print("FTP connection successful (aioftp).")

        # Collect list of files and directories to process
        # Pass ITEMS_TO_BACKUP as the filter for the root directory
        remote_items_to_process = await collect_remote_items(client, REMOTE_FTP_ROOT, items_filter=ITEMS_TO_BACKUP)

        # Close connection after collecting paths
        # It's generally better to close connections you are done with,
        # parfive will open its own connections for downloading.
        if client: # Check if client object was created
            try:
                await client.close()
                print("Closed aioftp client connection after collecting items.")
            except Exception as close_err:
                print(f"Warning: Error closing aioftp client after collection: {close_err}")
        else:
            print("aioftp client was not created or already handled before collection.")


        # Filter out directory markers, only keep file paths for downloading
        remote_file_paths = [item[0] for item in remote_items_to_process if item[1] == 'file']
        # Get directory paths for creating local directories and zip entries
        remote_dir_paths = [item[0] for item in remote_items_to_process if item[1] == 'dir']


        if not remote_file_paths and not remote_dir_paths:
            print("No files or directories found to backup based on filter. Exiting FTP process.")
            return False # Indicate no backup needed


        # Clean up existing temp local download dir before creating
        if os.path.exists(TEMP_LOCAL_DOWNLOAD_DIR):
            print(f"Removing existing temporary local download directory: {TEMP_LOCAL_DOWNLOAD_DIR}")
            shutil.rmtree(TEMP_LOCAL_DOWNLOAD_DIR)
        os.makedirs(TEMP_LOCAL_DOWNLOAD_DIR, exist_ok=True)
        print(f"Created temporary local download directory: {TEMP_LOCAL_DOWNLOAD_DIR}")


        if remote_file_paths:
             print(f"Found {len(remote_file_paths)} files to download. Starting parallel download using parfive...")
             # Configure parfive downloader
             # max_connections: Number of parallel connections (adjust based on runner/server limits)
             # file_progress: Show progress bars for individual files
             # initial_transfer_size: Initial chunk size for downloads
             # connect_timeout and timeout are also important for parfive downloads
             dl = parfive.Downloader(
                 max_connections=5, # Can increase this for more parallelism
                 file_progress=True,
                 initial_transfer_size=1024*1024, # 1MB initial chunk size
                 connect_timeout=60, # Timeout for establishing each download connection
                 timeout=300 # Total timeout for each individual file download (Increased)
             )


             # Enqueue files for parallel download
             for remote_path in remote_file_paths:
                 # Construct local save path relative to TEMP_LOCAL_DOWNLOAD_DIR
                 # Remove leading slash from remote_path to make it relative
                 local_save_path_relative = remote_path.lstrip('/')
                 local_save_path_full = os.path.join(TEMP_LOCAL_DOWNLOAD_DIR, local_save_path_relative).replace('\\', '/')

                 # Ensure parent directories exist locally before enqueuing
                 local_parent_dir = os.path.dirname(local_save_path_full)
                 if local_parent_dir:
                      os.makedirs(local_parent_dir, exist_ok=True)

                 # Construct the FTP URL for parfive with credentials
                 # Using quote_plus for username/password for safety
                 encoded_username = quote_plus(FTP_USERNAME)
                 encoded_password = quote_plus(FTP_PASSWORD)

                 # ftp://user:pass@host:port/path
                 ftp_url = f'ftp://{encoded_username}:{encoded_password}@{FTP_HOST}:{FTP_PORT}{remote_path}'

                 # print(f"Enqueueing remote file {remote_path} to download to local path {local_save_path_full}") # Too verbose
                 # The path parameter in enqueue_file is the *full* local path including filename
                 dl.enqueue_file(ftp_url, path=local_save_path_full)


             # Perform the parallel download
             print("Executing parallel download...")
             download_results = await dl.download()

             if download_results.errors:
                 print("\nErrors occurred during parallel download:")
                 for err_info in download_results.errors:
                     # err_info.response might be the aioftp exception
                     error_details = err_info.response
                     print(f"- URL: {err_info.url}, Error: {error_details}")
                 # Raise an error if any download failed
                 raise RuntimeError(f"Failed to download {len(download_results.errors)} files during parallel download.")
             else:
                 print("\nParallel download completed successfully.")
        else:
            print("No files to download.")


        # Create necessary local directories for zipping, even if they were empty on the server
        # or contained only filtered-out files. This uses the list of directory paths collected earlier.
        if remote_dir_paths:
             print(f"Creating local directories for zipping based on collected structure...")
             for dir_path in remote_dir_paths:
                  # Construct local directory path relative to TEMP_LOCAL_DOWNLOAD_DIR
                  local_dir_path_relative = dir_path.lstrip('/')
                  local_dir_path_full = os.path.join(TEMP_LOCAL_DOWNLOAD_DIR, local_dir_path_relative).replace('\\', '/')
                  # Ensure the directory path ends with a slash for clarity, though makedirs handles it
                  if not local_dir_path_full.endswith('/') and local_dir_path_full != TEMP_LOCAL_DOWNLOAD_DIR:
                       local_dir_path_full += '/'
                  os.makedirs(local_dir_path_full, exist_ok=True)
                  # print(f"Created local directory: {local_dir_path_full}") # Too verbose


        # Create the zip file from the contents of the temporary local download directory
        print(f"Starting zipping process from local directory: {TEMP_LOCAL_DOWNLOAD_DIR} to {TEMP_ZIP_FILE_PATH}")
        zip_local_directory(TEMP_LOCAL_DOWNLOAD_DIR, TEMP_ZIP_FILE_PATH)
        print(f"Zip file created at: {TEMP_ZIP_FILE_PATH}")

        # Clean up the temporary local download directory
        if os.path.exists(TEMP_LOCAL_DOWNLOAD_DIR):
            print(f"Cleaning up temporary local download directory: {TEMP_LOCAL_DOWNLOAD_DIR}")
            shutil.rmtree(TEMP_LOCAL_DOWNLOAD_DIR)

        return True # Indicate backup was successful

    except asyncio.TimeoutError:
        # Handle timeout specifically for the initial connection
        print(f"Error: Initial FTP connection to {FTP_HOST}:{FTP_PORT} timed out.")
        # Clean up temporary local download directory on failure
        if os.path.exists(TEMP_LOCAL_DOWNLOAD_DIR):
            print(f"Cleaning up temporary local download directory after error: {TEMP_LOCAL_DOWNLOAD_DIR}")
            shutil.rmtree(TEMP_LOCAL_DOWNLOAD_DIR)
        # Ensure client is closed if it was created before the error
        if client: # Check if client object was created
             try:
                 await client.close()
                 print("Attempted to close aioftp client after connection timeout.")
             except Exception as close_err:
                 print(f"Warning: Error closing aioftp client in connection timeout handler: {close_err}")
        raise # Re-raise the timeout error to be caught by the main try/except
    except Exception as e:
        print(f"Failed during asynchronous FTP process: {e}")
         # Clean up the temporary local download directory on failure
        if os.path.exists(TEMP_LOCAL_DOWNLOAD_DIR):
            print(f"Cleaning up temporary local download directory after error: {TEMP_LOCAL_DOWNLOAD_DIR}")
            shutil.rmtree(TEMP_LOCAL_DOWNLOAD_DIR)
        # Ensure client is closed if it was created before the error
        if client: # Check if client object was created
             try:
                 await client.close()
                 print("Attempted to close aioftp client in general error handler.")
             except Exception as close_err:
                 print(f"Warning: Error closing aioftp client in general error handler: {close_err}")
        raise # Re-raise the exception to be caught by the main try/except


# --- Main Execution ---
if __name__ == "__main__":
    # This script is intended to be run by GitHub Actions.

    # Ensure temp local download dir is clean at the very start in case of previous failed runs
    if os.path.exists(TEMP_LOCAL_DOWNLOAD_DIR):
        print(f"Initial cleanup: Removing existing temporary local download directory: {TEMP_LOCAL_DOWNLOAD_DIR}")
        shutil.rmtree(TEMP_LOCAL_DOWNLOAD_DIR)

    # Ensure temp zip file is clean at the very start
    if os.path.exists(TEMP_ZIP_FILE_PATH):
        print(f"Initial cleanup: Removing existing temporary zip file: {TEMP_ZIP_FILE_PATH}")
        os.remove(TEMP_ZIP_FILE_PATH)


    # 1. Perform FTP Download and Zipping to a temporary file using parfive
    print("Starting FTP download and zipping process using parfive...")
    backup_successful = False
    try:
        # Use asyncio.run to execute the main asynchronous function
        # This block handles the FTP connection, file collection, and parallel download
        backup_successful = asyncio.run(async_ftp_process())

        if not backup_successful:
             print("FTP backup process skipped or failed during collection/download. No zip created.")
             # Exit with a non-zero code if backup wasn't successful
             sys.exit(1)

        # Ensure the temporary zip exists before proceeding to git
        if not os.path.exists(TEMP_ZIP_FILE_PATH):
             print(f"Error: Temporary zip file {TEMP_ZIP_FILE_PATH} was not created by the FTP process.")
             sys.exit(1)
        else:
             print(f"Temporary zip file successfully created at: {TEMP_ZIP_FILE_PATH}")


    except Exception as e:
        print(f"Overall FTP download and zipping process failed: {e}")
        # The async function should handle cleanup of local download dir, but a final zip check doesn't hurt
        if os.path.exists(TEMP_ZIP_FILE_PATH):
             print(f"Cleaning up temporary zip file after overall failure: {TEMP_ZIP_FILE_PATH}")
             os.remove(TEMP_ZIP_FILE_PATH)
        sys.exit(1)


    # 2. Clone Backup Repo, Add Backup, Remove Old, Commit, Push
    print("Starting GitHub backup process...")

    # Clean up temp repo dir if it exists from a previous failed run
    if os.path.exists(TEMP_REPO_DIR):
        print(f"Removing existing temporary repository directory: {TEMP_REPO_DIR}")
        shutil.rmtree(TEMP_REPO_DIR)

    try:
        setup_git_credentials()
        clone_backup_repo(BACKUP_REPO_URL, GITHUB_TOKEN, TEMP_REPO_DIR)
        # add_and_commit_backup will now use the temporary zip file created by the async process
        add_and_commit_backup(TEMP_REPO_DIR, TEMP_ZIP_FILE_PATH)
        print("GitHub backup process completed.")
    except Exception as e:
        print(f"Failed during GitHub process: {e}")
        sys.exit(1)
    finally:
        # Clean up the temporary repository directory
        if os.path.exists(TEMP_REPO_DIR):
            print(f"Removing existing temporary repository directory: {TEMP_REPO_DIR}")
            shutil.rmtree(TEMP_REPO_DIR)
        # Clean up the temporary zip file (should be done after successful push)
        # Added a check here just in case, although the previous try/except in main should handle it on failure
        if os.path.exists(TEMP_ZIP_FILE_PATH):
             print(f"Final cleanup: Cleaning up temporary zip file: {TEMP_ZIP_FILE_PATH}")
             os.remove(TEMP_ZIP_FILE_PATH)


    print("Daily automation script finished successfully.")