import os
import sys
import ftplib # Use ftplib for standard FTP
import io
import zipfile
import datetime
import subprocess
import shutil
import time # Import time for potential delays

# --- Configuration from Environment Variables ---
# FTP Details
FTP_HOST = 'ftp.minefort.com'
FTP_PORT = 21 # Default FTP port
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
DATE_STR = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S") # Include time for uniqueness if needed
BACKUP_ZIP_FILENAME = f"server_backup_{DATE_STR}.zip"
TEMP_REPO_DIR = 'temp_backup_repo' # Temporary directory to clone the backup repo into
TEMP_ZIP_FILE_PATH = f"/tmp/{BACKUP_ZIP_FILENAME}" # Temporary location to save the zip before git

# --- FTP Download and Zip (using ftplib) ---
def ftp_recursive_download_and_zip(ftp_client, remote_path, zip_file):
    """Recursively downloads files from FTP to a zip file object."""
    print(f"Entering remote directory: {remote_path}")
    original_cwd = ftp_client.pwd() # Store original directory

    try:
        ftp_client.cwd(remote_path)
        items = ftp_client.nlst() # Get list of files and directories

        for item in items:
            # ftplib doesn't have easy isdir/isfile. Try to change directory.
            # If cwd succeeds, it's a directory. If it fails, it's likely a file.
            # This is a common ftplib pattern.
            full_remote_path = f"{remote_path}/{item}".replace('//', '/')

            try:
                # Try to change directory - if it works, it's a directory
                ftp_client.cwd(item)
                print(f"Found remote directory: {full_remote_path}")
                # Change back to process contents
                ftp_client.cwd(original_cwd) # Go back before recursing

                # Create directory in zip (important for empty dirs)
                zip_path_in_zip = os.path.relpath(full_remote_path, REMOTE_FTP_ROOT)
                if not zip_path_in_zip.endswith('/'):
                     zip_path_in_zip += '/'
                print(f"Adding directory to zip: {zip_path_in_zip}")
                try:
                    # ftplib needs the path relative to the initial root being zipped
                    zip_file.writestr(zip_path_in_zip, "") # Add empty directory entry
                except Exception as e:
                     print(f"Error adding directory {zip_path_in_zip} to zip: {e}")

                # Recurse into directory
                ftp_recursive_download_and_zip(ftp_client, full_remote_path, zip_file)

            except ftplib.error_perm:
                # If cwd fails, it's likely a file
                print(f"Found remote file: {full_remote_path}")
                zip_path_in_zip = os.path.relpath(full_remote_path, REMOTE_FTP_ROOT)
                print(f"Downloading file and zipping: {zip_path_in_zip}")
                try:
                    # ftplib needs the path relative to the current CWD on the server
                    # Since we change back to original_cwd, we need item here
                    # Or change CWD to remote_path before calling retrbinary
                    # Let's change CWD to remote_path temporarily for retrbinary
                    ftp_client.cwd(remote_path)
                    with io.BytesIO() as file_buffer:
                         # ftplib's retrbinary takes a command and a callback
                         ftp_client.retrbinary(f'RETR {item}', file_buffer.write)
                         file_buffer.seek(0)
                         # Add file from buffer to zip
                         zip_file.writestr(zip_path_in_zip, file_buffer.read())
                    print(f"Successfully added {zip_path_in_zip} to zip.")
                    ftp_client.cwd(original_cwd) # Change back

                except Exception as e:
                    print(f"Error downloading/zipping file {full_remote_path}: {e}")
                    # Change back in case of error
                    try:
                        ftp_client.cwd(original_cwd)
                    except:
                        pass # Ignore if changing back fails

    except ftplib.error_perm as e:
        print(f"Permission error accessing directory {remote_path}: {e}")
        # This might happen if list permissions are denied. Log and continue.
    except Exception as e:
        print(f"Error processing directory {remote_path}: {e}")
        # Change back in case of error
        try:
            ftp_client.cwd(original_cwd)
        except:
            pass # Ignore if changing back fails

# --- GitHub Interaction ---
def setup_git_credentials():
    """Sets up Git credentials for the runner."""
    print("Setting up Git credentials...")
    try:
        subprocess.run(['git', 'config', '--global', 'user.email', 'action@github.com'], check=True)
        subprocess.run(['git', 'config', '--global', 'user.name', 'GitHub Actions'], check=True)
        print("Git user configured.")
    except subprocess.CalledProcessError as e:
        print(f"Error configuring git user: {e}")
        sys.exit(1)


def clone_backup_repo(repo_url, token, target_dir):
    """Clones the backup repository using the token."""
    print(f"Cloning backup repository {repo_url} into {target_dir}...")
    # Embed token in the URL for cloning
    repo_url_with_token = repo_url.replace('https://github.com/', f'https://oauth2:{token}@github.com/', 1)
    repo_url_with_token = repo_url_with_token.replace('http://github.com/', f'http://oauth2:{token}@github.com/', 1)

    try:
        subprocess.run(['git', 'clone', repo_url_with_token, target_dir], check=True)
        print("Repository cloned successfully.")
    except subprocess.CalledProcessError as e:
        print(f"Error cloning repository: {e}")
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
            old_backups = sorted(glob.glob(os.path.join(backup_dir_full_path, "server_backup_*.zip")))
            if old_backups:
                print(f"Found potential old backups: {old_backups}")
                # Get the filename of the new backup being added
                new_backup_filename = os.path.basename(backup_filepath)

                for old_file_path in old_backups:
                    if os.path.basename(old_file_path) != new_backup_filename:
                        print(f"Found old backup, attempting to remove: {old_file_path}")
                        try:
                            # Use git rm to remove the file and stage the deletion
                            subprocess.run(['git', 'rm', '-f', old_file_path], check=True)
                            print(f"Staged removal of {old_file_path}")
                        except subprocess.CalledProcessError as e:
                            print(f"Error staging removal of old backup {old_file_path}: {e}")
                            # Log error, but try to continue with other files

        # Add the new backup file
        new_backup_target_dir = os.path.join(os.getcwd(), BACKUP_FOLDER_IN_REPO)
        os.makedirs(new_backup_target_dir, exist_ok=True) # Ensure target directory exists
        new_backup_target_path = os.path.join(new_backup_target_dir, os.path.basename(backup_filepath))

        print(f"Copying new backup file into repository: {new_backup_target_path}")
        shutil.copy2(backup_filepath, new_backup_target_path) # Use copy2 to preserve metadata if needed
        print(f"Copied created zip to {new_backup_target_path}")

        # Add the new backup file to staging
        print(f"Adding new backup file to git staging: {new_backup_target_path}")
        try:
            subprocess.run(['git', 'add', new_backup_target_path], check=True)
            print("New backup file added to staging.")
        except subprocess.CalledProcessError as e:
            print(f"Error adding new backup file {new_backup_target_path}: {e}")
            sys.exit(1)

        # Commit changes
        # Check if there are any staged changes before committing
        status_output = subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True, check=True).stdout.strip()
        if status_output:
            commit_message = f"Automated backup: {os.path.basename(backup_filepath)}"
            print(f"Committing with message: '{commit_message}'")
            try:
                subprocess.run(['git', 'commit', '-m', commit_message], check=True)
                print("Changes committed.")
            except subprocess.CalledProcessError as e:
                print(f"Error committing changes: {e}")
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
            original_remote_url = subprocess.run(['git', 'remote', 'get-url', remote_name], capture_output=True, text=True, check=True).stdout.strip()
             # Replace potential http/https with token embedded version for push
            push_url = original_remote_url.replace('https://github.com/', f'https://oauth2:{GITHUB_TOKEN}@github.com/', 1)
            push_url = push_url.replace('http://github.com/', f'http://oauth2:{GITHUB_TOKEN}@github.com/', 1)

            # Push the current branch (HEAD) to its upstream
            current_branch = subprocess.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()

            # Use --force-with-lease if overwriting history (e.g. always having only 1 backup file)
            # Or standard push if keeping history (e.g. keeping multiple dated backups)
            # With deleting old ones, standard push should work unless there are merge conflicts (unlikely in a dedicated backup repo)
            print(f"Pushing from branch {current_branch} to {push_url}")
            subprocess.run(['git', 'push', push_url, current_branch], check=True)
            print("Changes pushed successfully.")
        except subprocess.CalledProcessError as e:
            print(f"Error pushing changes: {e}")
            sys.exit(1)
    except Exception as e:
         print(f"An unexpected error occurred during git operations: {e}")
         sys.exit(1)
    finally:
        # Change back to the original directory
        os.chdir(original_dir)


# --- Main Execution ---
if __name__ == "__main__":
    # We will write the zip to a temporary file on the runner before adding to git
    # This avoids potential memory issues with very large backups if the in-memory approach struggles.
    # It's still 'zero local file' from your PC perspective.

    # 1. Perform FTP Download and Zipping to a temporary file
    print("Starting FTP download and zipping to temporary file...")
    try:
        print(f"Connecting to FTP: {FTP_HOST}:{FTP_PORT} with user {FTP_USERNAME}")
        # Use ftplib for standard FTP
        with ftplib.FTP() as ftp:
             ftp.connect(FTP_HOST, FTP_PORT)
             ftp.login(user=FTP_USERNAME, passwd=FTP_PASSWORD)
             print("FTP connection successful.")

             with zipfile.ZipFile(TEMP_ZIP_FILE_PATH, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                 ftp_recursive_download_and_zip(ftp, REMOTE_FTP_ROOT, zip_file)

             print(f"FTP download and zipping complete. Zip saved to {TEMP_ZIP_FILE_PATH}")

    except Exception as e:
        print(f"Failed during FTP process: {e}")
        sys.exit(1)

    # 2. Clone Backup Repo, Add Backup, Remove Old, Commit, Push
    print("Starting GitHub backup process...")

    # Clean up temp dir if it exists from a previous failed run
    if os.path.exists(TEMP_REPO_DIR):
        print(f"Removing existing temporary repository directory: {TEMP_REPO_DIR}")
        shutil.rmtree(TEMP_REPO_DIR)

    try:
        setup_git_credentials()
        clone_backup_repo(BACKUP_REPO_URL, GITHUB_TOKEN, TEMP_REPO_DIR)
        add_and_commit_backup(TEMP_REPO_DIR, TEMP_ZIP_FILE_PATH) # Use the path to the temp zip file
        print("GitHub backup process completed.")
    except Exception as e:
        print(f"Failed during GitHub process: {e}")
        # Note: Git operations might fail for various reasons (network, permissions, etc.)
        sys.exit(1)
    finally:
        # Clean up the temporary repository directory
        if os.path.exists(TEMP_REPO_DIR):
            print(f"Cleaning up temporary repository directory: {TEMP_REPO_DIR}")
            shutil.rmtree(TEMP_REPO_DIR)
        # Clean up the temporary zip file
        if os.path.exists(TEMP_ZIP_FILE_PATH):
             print(f"Cleaning up temporary zip file: {TEMP_ZIP_FILE_PATH}")
             os.remove(TEMP_ZIP_FILE_PATH)


    print("Daily automation script finished successfully.")
