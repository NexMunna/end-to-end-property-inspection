Compress-Archive -Path * -DestinationPath function.zip -Force; Get-ChildItem function.zip | Select-Object Name, Length
