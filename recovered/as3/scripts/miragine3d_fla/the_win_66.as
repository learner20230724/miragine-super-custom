package miragine3d_fla
{
   import flash.display.MovieClip;
   
   [Embed(source="/_assets/assets.swf", symbol="symbol247")]
   public dynamic class the_win_66 extends MovieClip
   {
      
      public var flag_win:MovieClip;
      
      public function the_win_66()
      {
         super();
         addFrameScript(0,this.frame1);
      }
      
      internal function frame1() : *
      {
         addChild(new Flag(this.flag_win));
      }
   }
}

