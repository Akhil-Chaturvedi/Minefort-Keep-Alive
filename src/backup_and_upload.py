import os
import sys
import pysftp # Or ftplib if pysftp doesn't work for you
import io
import zipfile
import datetime
import subprocess
import shutil

# --- Configuration from Environment Variables ---
# FTP Details
FTP_HOST = 'ftp.minefort.com'
FTP_PORT = 21
FTP_USERNAME = os.environ.get('FTP_USERNAME')
FTP_PASSWORD = os.environ.get('FTP_PASSWORD')
REMOTE_FTP_ROOT = '/' # The directory on the FTP server to backup (usually '/')

# GitHub Details
BACKUP_REPO_URL = os.environ.get('BACKUP_REPO_URL') # e.g., https://github.com/yourusername/your-backup-repo.git
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')
BACKUP_FOLDER_IN_REPO = 'backups' # Folder inside your GitHub repo to store zips

# --- Validation ---
if not all([FTP_USERNAME, FTP_PASSWORD, BACKUP_REPO_URL, GITHUB_TOKEN]):
    print("Error: FTP_USERNAME, FTP_PASSWORD, BACKUP_REPO_URL, and GITHUB_TOKEN environment variables must be set.")
    sys.exit(1)

# --- Constants ---
DATE_STR = datetime.datetime.now().strftime("%Y-%m-%d")
BACKUP_ZIP_FILENAME = f"server_backup_{DATE_STR}.zip"
TEMP_REPO_DIR = 'temp_backup_repo' # Temporary directory to clone the backup repo into

# --- FTP Download and Zip (In-Memory) ---
def ftp_recursive_download_and_zip_in_memory(ftp_client, remote_path, zip_buffer, zip_file):
    """Recursively downloads files from FTP to an in-memory zip."""
    print(f"Entering remote directory: {remote_path}")
    try:
        ftp_client.cwd(remote_path)
        items = ftp_client.listdir()
        print(f"Listing contents: {items}")

        for item in items:
            if item in ['.', '..']:
                continue

            full_remote_path = f"{remote_path}/{item}".replace('//', '/') # Handle root correctly

            # Check if it's a directory or file. This is tricky with plain FTP.
            # pysftp.isdir and pysftp.isfile are more reliable than ftplib.nlst checks
            try:
                if ftp_client.isdir(full_remote_path):
                    print(f"Found remote directory: {full_remote_path}")
                    # Create directory in zip (important for empty dirs)
                    zip_path_in_zip = os.path.relpath(full_remote_path, REMOTE_FTP_ROOT)
                    if not zip_path_in_zip.endswith('/'):
                         zip_path_in_zip += '/'
                    print(f"Adding directory to zip: {zip_path_in_zip}")
                    try:
                        zip_file.writestr(zip_path_in_zip, "") # Add empty directory
                    except Exception as e:
                         print(f"Error adding directory {zip_path_in_zip} to zip: {e}")
                    # Recurse into directory
                    ftp_recursive_download_and_zip_in_memory(ftp_client, full_remote_path, zip_buffer, zip_file)
                elif ftp_client.isfile(full_remote_path):
                    print(f"Found remote file: {full_remote_path}")
                    zip_path_in_zip = os.path.relpath(full_remote_path, REMOTE_FTP_ROOT)
                    print(f"Downloading file to memory and zipping: {zip_path_in_zip}")
                    try:
                        # Download file directly into BytesIO buffer
                        file_buffer = io.BytesIO()
                        ftp_client.getfo(full_remote_path, file_buffer)
                        file_buffer.seek(0) # Rewind buffer to read from the beginning

                        # Add file from buffer to zip
                        zip_file.writestr(zip_path_in_zip, file_buffer.read())
                        print(f"Successfully added {zip_path_in_zip} to zip.")

                    except Exception as e:
                        print(f"Error downloading/zipping file {full_remote_path}: {e}")
            except Exception as e:
                 # Fallback check or just log error if isdir/isfile fails unexpectedly
                 print(f"Could not determine type for {full_remote_path}, skipping or attempting as file (pysftp issue?): {e}")
                 # Optionally, add a fallback to try downloading as a file if type check fails
                 try:
                      print(f"Attempting to download {full_remote_path} as file fallback...")
                      zip_path_in_zip = os.path.relpath(full_remote_path, REMOTE_FTP_ROOT)
                      file_buffer = io.BytesIO()
                      ftp_client.getfo(full_remote_path, file_buffer)
                      file_buffer.seek(0)
                      zip_file.writestr(zip_path_in_zip, file_buffer.read())
                      print(f"Successfully added {zip_path_in_zip} to zip via fallback.")
                 except Exception as fallback_e:
                      print(f"Fallback download for {full_remote_path} failed: {fallback_e}")


    except Exception as e:
        print(f"Error processing directory {remote_path}: {e}")
        # Depending on severity, you might want to sys.exit(1) here
        # For now, we'll try to continue with other directories if possible

# --- GitHub Interaction ---
def setup_git_credentials(token, repo_url):
    """Sets up Git credentials using the token for the specific repo."""
    print("Setting up Git credentials...")
    # Use git config to store credentials temporarily
    # WARNING: Ensure this is run in a secure environment like GitHub Actions
    # This avoids writing the token to a file on the runner.
    # However, using a Git URL with the token embedded is often simpler in Actions.
    # e.g., https://oauth2:${{ secrets.GITHUB_TOKEN }}@github.com/user/repo.git
    # Let's use the simpler URL embedding approach for the clone command.
    pass # No explicit setup needed if embedding token in URL

def clone_backup_repo(repo_url_with_token, target_dir):
    """Clones the backup repository."""
    print(f"Cloning backup repository {repo_url_with_token} into {target_dir}...")
    try:
        subprocess.run(['git', 'clone', repo_url_with_token, target_dir], check=True)
        print("Repository cloned successfully.")
    except subprocess.CalledProcessError as e:
        print(f"Error cloning repository: {e}")
        sys.exit(1)

def add_and_commit_backup(repo_dir, backup_filepath):
    """Adds, commits the new backup, and removes old ones."""
    print(f"Changing directory to {repo_dir}")
    os.chdir(repo_dir)

    # Configure Git user (required for commit)
    subprocess.run(['git', 'config', 'user.email', 'action@github.com'], check=True)
    subprocess.run(['git', 'config', 'user.name', 'GitHub Actions'], check=True)
    print("Git user configured.")

    # Find and delete old backups in the backup folder
    backup_dir_full_path = os.path.join(os.getcwd(), BACKUP_FOLDER_IN_REPO)
    if os.path.exists(backup_dir_full_path):
        print(f"Looking for old backups in {backup_dir_full_path}")
        for filename in os.listdir(backup_dir_full_path):
            if filename.startswith("server_backup_") and filename.endswith(".zip") and filename != os.path.basename(backup_filepath):
                old_file_path = os.path.join(backup_dir_full_path, filename)
                print(f"Found old backup, attempting to remove: {old_file_path}")
                try:
                    subprocess.run(['git', 'rm', '-f', old_file_path], check=True)
                    print(f"Removed {old_file_path}")
                except subprocess.CalledProcessError as e:
                    print(f"Error removing old backup {old_file_path}: {e}")
                    # Continue trying to remove others, but log the error

    # Add the new backup file
    new_backup_target_path = os.path.join(BACKUP_FOLDER_IN_REPO, os.path.basename(backup_filepath))
    print(f"Adding new backup file to git: {new_backup_target_path}")
    try:
        # Ensure the target directory exists in the cloned repo
        os.makedirs(os.path.dirname(new_backup_target_path), exist_ok=True)
        # Move the created zip file into the repository's backup folder
        shutil.move(backup_filepath, new_backup_target_path)
        print(f"Moved created zip to {new_backup_target_path}")

        subprocess.run(['git', 'add', new_backup_target_path], check=True)
        print("New backup file added to staging.")
    except subprocess.CalledProcessError as e:
        print(f"Error adding new backup file {new_backup_target_path}: {e}")
        sys.exit(1)


    # Commit changes
    commit_message = f"Automated backup: {BACKUP_ZIP_FILENAME}"
    print(f"Committing with message: '{commit_message}'")
    try:
        subprocess.run(['git', 'commit', '-m', commit_message], check=True)
        print("Changes committed.")
    except subprocess.CalledProcessError as e:
        print(f"Error committing changes: {e}. This might happen if there were no changes (e.g., no old backup found, or the new one is identical).")
        # Allow failure here, it might just mean nothing changed or no old file to remove

    # Push changes
    print("Pushing changes to remote repository...")
    try:
        # Use the token embedded URL for pushing
        # Need the original remote URL here
        # Let's get the remote URL from the cloned repo config
        remote_name = subprocess.run(['git', 'remote'], capture_output=True, text=True, check=True).stdout.strip()
        if not remote_name:
             print("Error: Could not determine git remote name.")
             sys.exit(1)
        # Reconstruct the URL with token for the push command
        # Assuming the original URL was HTTPS. Adjust if SSH is used.
        original_remote_url = subprocess.run(['git', 'remote', 'get-url', remote_name], capture_output=True, text=True, check=True).stdout.strip()
        # Replace potential http/https with token embedded version
        push_url = original_remote_url.replace('https://github.com/', f'https://oauth2:{GITHUB_TOKEN}@github.com/', 1)
        push_url = push_url.replace('http://github.com/', f'http://oauth2:{GITHUB_TOKEN}@github.com/', 1)

        print(f"Pushing to {push_url}...")
        # Use --set-upstream to push correctly the first time
        current_branch = subprocess.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
        subprocess.run(['git', 'push', push_url, f'HEAD:{current_branch}'], check=True)
        print("Changes pushed successfully.")
    except subprocess.CalledProcessError as e:
        print(f"Error pushing changes: {e}")
        sys.exit(1)
    finally:
        # Change back to the original directory before the script exits
        os.chdir('../..') # Assuming script starts from repo root, moves to temp_backup_repo, need to go up two levels

# --- Main Execution ---
if __name__ == "__main__":
    backup_zip_path = BACKUP_ZIP_FILENAME # Create zip in the current working directory initially

    # 1. Perform FTP Download and Zipping (In-Memory)
    print("Starting FTP download and in-memory zipping...")
    zip_buffer = io.BytesIO()
    try:
        # Use pysftp for potentially better handling
        cnopts = pysftp.CnOpts()
        cnopts.hostkeys = None # WARNING: Disable host key checking - use known_hosts in production!
                               # For a temporary runner, this is often necessary but less secure.
                               # For a persistent runner (VPS), configure known_hosts properly.

        print(f"Connecting to FTP: {FTP_HOST}:{FTP_PORT} with user {FTP_USERNAME}")
        with pysftp.Connection(FTP_HOST, username=FTP_USERNAME, password=FTP_PASSWORD, port=FTP_PORT, cnopts=cnopts) as sftp:
             print("FTP connection successful.")
             with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                 ftp_recursive_download_and_zip_in_memory(sftp, REMOTE_FTP_ROOT, zip_buffer, zip_file)
             print("FTP download and zipping complete.")

    except Exception as e:
        print(f"Failed during FTP process: {e}")
        sys.exit(1)

    # Write the in-memory zip buffer to a temporary file to be added to Git
    try:
        zip_buffer.seek(0) # Rewind buffer
        with open(backup_zip_path, 'wb') as f:
            f.write(zip_buffer.read())
        print(f"In-memory zip written to temporary file: {backup_zip_path}")
    except Exception as e:
        print(f"Error writing zip buffer to file: {e}")
        sys.exit(1)

    # 2. Clone Backup Repo, Add Backup, Remove Old, Commit, Push
    print("Starting GitHub backup process...")
    # Embed token in URL for cloning and pushing
    repo_url_with_token = BACKUP_REPO_URL.replace('https://github.com/', f'https://oauth2:{GITHUB_TOKEN}@github.com/', 1)
    repo_url_with_token = repo_url_with_token.replace('http://github.com/', f'http://oauth2:{GITHUB_TOKEN}@github.com/', 1)


    try:
        # Clean up temp dir if it exists from a previous failed run
        if os.path.exists(TEMP_REPO_DIR):
            print(f"Removing existing temporary repository directory: {TEMP_REPO_DIR}")
            shutil.rmtree(TEMP_REPO_DIR)

        clone_backup_repo(repo_url_with_token, TEMP_REPO_DIR)
        add_and_commit_backup(TEMP_REPO_DIR, backup_zip_path) # backup_zip_path is moved inside this function
        print("GitHub backup process completed.")
    except Exception as e:
        print(f"Failed during GitHub process: {e}")
        sys.exit(1)
    finally:
        # Clean up the temporary repository directory
        if os.path.exists(TEMP_REPO_DIR):
            print(f"Cleaning up temporary repository directory: {TEMP_REPO_DIR}")
            shutil.rmtree(TEMP_REPO_DIR)
        # Also clean up the temporary zip file if it wasn't moved/deleted
        if os.path.exists(backup_zip_path):
             print(f"Cleaning up temporary zip file: {backup_zip_path}")
             os.remove(backup_zip_path)


    print("Daily automation script finished.")
