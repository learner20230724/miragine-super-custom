package miragine3d_fla
{
   import flash.display.MovieClip;
   
   [Embed(source="/_assets/assets.swf", symbol="symbol209")]
   public dynamic class cursor_57 extends MovieClip
   {
      
      public function cursor_57()
      {
         super();
         addFrameScript(0,this.frame1);
      }
      
      internal function frame1() : *
      {
         stop();
         this.mouseChildren = false;
         this.mouseEnabled = false;
      }
   }
}

